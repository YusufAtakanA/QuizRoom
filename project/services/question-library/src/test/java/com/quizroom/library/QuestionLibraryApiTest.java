package com.quizroom.library;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "quizroom.jwt.secret=test-secret-that-is-at-least-32-bytes-long",
        "spring.datasource.url=jdbc:h2:mem:library-test",
        "quizroom.ai.timeout=PT1S"})
@AutoConfigureMockMvc
class QuestionLibraryApiTest {

    static final String NOTES = "HTTP 404 means the requested resource was not found. HTTP 200 means OK.";

    static final String AI_RESPONSE = """
            {"model": "fake", "questions": [
              {"text": "What does HTTP 404 mean?", "options": ["OK", "Not Found", "Forbidden", "Server Error"],
               "correctIndex": 1, "explanation": "404 is Not Found.",
               "sourceExcerpt": "HTTP 404 means the requested   resource was not found."},
              {"text": "Duplicate options", "options": ["A", "A", "B", "C"],
               "correctIndex": 0, "explanation": "x", "sourceExcerpt": "HTTP 200 means OK."},
              {"text": "Made-up source", "options": ["A", "B", "C", "D"],
               "correctIndex": 0, "explanation": "x", "sourceExcerpt": "This sentence is not in the notes."}
            ], "rejected": []}""";

    static volatile String aiMode = "ok";
    static HttpServer fakeAi;

    @DynamicPropertySource
    static void startFakeAi(DynamicPropertyRegistry registry) throws IOException {
        fakeAi = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        fakeAi.setExecutor(Executors.newCachedThreadPool());
        fakeAi.createContext("/generate", exchange -> {
            try {
                if (aiMode.equals("slow")) Thread.sleep(2000);
                byte[] body = (aiMode.equals("down") ? "{}" : AI_RESPONSE).getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(aiMode.equals("down") ? 500 : 200, body.length);
                exchange.getResponseBody().write(body);
            } catch (Exception ignored) {
            } finally {
                exchange.close();
            }
        });
        fakeAi.start();
        registry.add("quizroom.ai.url", () -> "http://localhost:" + fakeAi.getAddress().getPort());
    }

    @AfterAll
    static void stopFakeAi() {
        fakeAi.stop(0);
    }

    @AfterEach
    void resetAi() {
        aiMode = "ok";
    }

    @Autowired
    MockMvc mvc;

    final String host = UUID.randomUUID().toString();
    final String otherHost = UUID.randomUUID().toString();

    @Test
    void questionLifecycleFollowsApprovalRules() throws Exception {
        String quizId = createQuiz(host);

        send(post("/api/quizzes/" + quizId + "/questions"), host, question("Q", "\"A\", \"a \", \"B\", \"C\"", 0))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("The four options must be different"));
        send(post("/api/quizzes/" + quizId + "/questions"), host, question("Q", "\"A\", \"B\", \"C\"", 0))
                .andExpect(status().isBadRequest());
        send(post("/api/quizzes/" + quizId + "/questions"), host, question("Q", "\"A\", \"B\", \"C\", \"D\"", 4))
                .andExpect(status().isBadRequest());

        String questionId = addQuestion(host, quizId, "Capital of France?");

        send(get("/api/quizzes/" + quizId + "/snapshot"), host, null).andExpect(status().isConflict());

        send(post("/api/quizzes/" + quizId + "/questions/" + questionId + "/approve"), host, null)
                .andExpect(jsonPath("$.status").value("APPROVED"));
        send(get("/api/quizzes"), host, null)
                .andExpect(jsonPath("$[0].ready").value(true))
                .andExpect(jsonPath("$[0].approvedCount").value(1));

        send(put("/api/quizzes/" + quizId + "/questions/" + questionId), host,
                question("Capital of Spain?", "\"Madrid\", \"Paris\", \"Rome\", \"Oslo\"", 0))
                .andExpect(jsonPath("$.status").value("DRAFT"));
        send(get("/api/quizzes/" + quizId), host, null).andExpect(jsonPath("$.ready").value(false));

        send(post("/api/quizzes/" + quizId + "/questions/" + questionId + "/approve"), host, null);
        send(get("/api/quizzes/" + quizId + "/snapshot"), host, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.questions[0].text").value("Capital of Spain?"))
                .andExpect(jsonPath("$.questions[0].correctIndex").value(0));
    }

    @Test
    void hostsCannotSeeOrChangeOtherHostsQuizzes() throws Exception {
        String quizId = createQuiz(host);
        String questionId = addQuestion(host, quizId, "Mine?");

        send(get("/api/quizzes/" + quizId), otherHost, null).andExpect(status().isNotFound());
        send(post("/api/quizzes/" + quizId + "/questions/" + questionId + "/approve"), otherHost, null)
                .andExpect(status().isNotFound());
        send(delete("/api/quizzes/" + quizId), otherHost, null).andExpect(status().isNotFound());
        send(get("/api/quizzes"), otherHost, null).andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/api/quizzes")).andExpect(status().isUnauthorized());
    }

    @Test
    void atMostTenQuestionsCanBeApproved() throws Exception {
        String quizId = createQuiz(host);
        for (int i = 1; i <= 11; i++) {
            String questionId = addQuestion(host, quizId, "Question " + i);
            send(post("/api/quizzes/" + quizId + "/questions/" + questionId + "/approve"), host, null)
                    .andExpect(i <= 10 ? status().isOk() : status().isUnprocessableEntity());
        }
    }

    @Test
    void discardAndDeleteRemoveData() throws Exception {
        String quizId = createQuiz(host);
        String questionId = addQuestion(host, quizId, "Throw away");

        send(delete("/api/quizzes/" + quizId + "/questions/" + questionId), host, null).andExpect(status().isNoContent());
        send(get("/api/quizzes/" + quizId), host, null).andExpect(jsonPath("$.questions.length()").value(0));

        send(delete("/api/quizzes/" + quizId), host, null).andExpect(status().isNoContent());
        send(get("/api/quizzes/" + quizId), host, null).andExpect(status().isNotFound());
    }

    @Test
    void generationKeepsOnlyValidDraftsSupportedByTheNotes() throws Exception {
        String quizId = createQuiz(host);

        send(post("/api/quizzes/" + quizId + "/generate"), host, generateBody(3))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.created.length()").value(1))
                .andExpect(jsonPath("$.created[0].status").value("DRAFT"))
                .andExpect(jsonPath("$.created[0].sourceExcerpt").exists())
                .andExpect(jsonPath("$.rejected.length()").value(2));

        send(get("/api/quizzes/" + quizId), host, null)
                .andExpect(jsonPath("$.questions.length()").value(1))
                .andExpect(jsonPath("$.notes").value(NOTES))
                .andExpect(jsonPath("$.ready").value(false));
    }

    @Test
    void generationNeverExceedsRequestedCount() throws Exception {
        String quizId = createQuiz(host);
        send(post("/api/quizzes/" + quizId + "/generate"), host, generateBody(11)).andExpect(status().isBadRequest());
    }

    @Test
    void unavailableOrSlowAiSavesNothing() throws Exception {
        String quizId = createQuiz(host);

        aiMode = "down";
        send(post("/api/quizzes/" + quizId + "/generate"), host, generateBody(2))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.detail").value("AI generation unavailable"));

        aiMode = "slow";
        send(post("/api/quizzes/" + quizId + "/generate"), host, generateBody(2))
                .andExpect(status().isGatewayTimeout());

        send(get("/api/quizzes/" + quizId), host, null).andExpect(jsonPath("$.questions.length()").value(0));
    }

    @Test
    void onlyTokensFromAccountsForThisServiceAreAccepted() throws Exception {
        mvc.perform(get("/api/quizzes").header("Authorization", "Bearer " + token("quizroom-accounts", "quizroom-library")))
                .andExpect(status().isOk());
        mvc.perform(get("/api/quizzes").header("Authorization", "Bearer " + token("quizroom-accounts", "quizroom-other")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/quizzes").header("Authorization", "Bearer " + token("someone-else", "quizroom-library")))
                .andExpect(status().isUnauthorized());
    }

    private static String token(String issuer, String audience) {
        var key = new SecretKeySpec("test-secret-that-is-at-least-32-bytes-long".getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .audience(List.of(audience))
                .subject(UUID.randomUUID().toString())
                .issuedAt(now)
                .expiresAt(now.plusSeconds(60))
                .build();
        return new NimbusJwtEncoder(new ImmutableSecret<>(key))
                .encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }

    private String createQuiz(String owner) throws Exception {
        String body = send(post("/api/quizzes"), owner, "{\"title\": \"Test quiz\"}")
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }

    private String addQuestion(String owner, String quizId, String text) throws Exception {
        String body = send(post("/api/quizzes/" + quizId + "/questions"), owner,
                question(text, "\"Paris\", \"Rome\", \"Berlin\", \"Madrid\"", 0))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }

    private static String question(String text, String options, int correctIndex) {
        return "{\"text\": \"" + text + "\", \"options\": [" + options + "], \"correctIndex\": " + correctIndex + "}";
    }

    private static String generateBody(int count) {
        return "{\"notes\": \"" + NOTES + "\", \"count\": " + count + "}";
    }

    private ResultActions send(MockHttpServletRequestBuilder request, String owner, String json) throws Exception {
        request.with(jwt().jwt(j -> j.subject(owner)));
        if (json != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(json);
        }
        return mvc.perform(request);
    }
}
