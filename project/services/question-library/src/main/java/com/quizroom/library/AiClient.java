package com.quizroom.library;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.List;
import java.util.Map;

@Component
public class AiClient {

    public record GeneratedQuestion(String text, List<String> options, Integer correctIndex,
                                    String explanation, String sourceExcerpt) {
    }

    public record Rejected(Integer index, String reason) {
    }

    public record Generation(List<GeneratedQuestion> questions, List<Rejected> rejected) {
    }

    private final RestClient rest;

    public AiClient(RestClient.Builder builder,
                    @Value("${quizroom.ai.url}") String baseUrl,
                    @Value("${quizroom.ai.timeout}") Duration timeout) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(timeout);
        this.rest = builder.baseUrl(baseUrl).requestFactory(factory).build();
    }

    public Generation generate(String notes, int count) {
        try {
            Generation result = rest.post()
                    .uri("/generate")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("notes", notes, "count", count))
                    .retrieve()
                    .body(Generation.class);
            if (result == null || result.questions() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "AI generation returned no questions");
            }
            return result;
        } catch (RestClientException e) {
            if (e.getMostSpecificCause() instanceof SocketTimeoutException) {
                throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT, "AI generation timed out");
            }
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI generation unavailable");
        }
    }
}
