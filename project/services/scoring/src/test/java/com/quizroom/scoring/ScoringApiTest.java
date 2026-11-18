package com.quizroom.scoring;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.hamcrest.Matchers.contains;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "quizroom.jwt.secret=test-secret-that-is-at-least-32-bytes-long",
        "spring.datasource.url=jdbc:h2:mem:scoring-test"})
@AutoConfigureMockMvc
class ScoringApiTest {

    static final String PLAYERS = players("p1:Alice", "p2:bob", "p3:Cara");

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    final String host = UUID.randomUUID().toString();
    final String otherHost = UUID.randomUUID().toString();
    final String gameId = UUID.randomUUID().toString();

    @Test
    void correctWrongAndMissingAnswersAccumulateAcrossQuestions() throws Exception {
        score(host, gameId, 0, 1, PLAYERS, answers("p1:1", "p2:0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.gameId").value(gameId))
                .andExpect(jsonPath("$.questionIndex").value(0))
                .andExpect(jsonPath("$.leaderboard[*].playerId", contains("p1", "p2", "p3")))
                .andExpect(jsonPath("$.leaderboard[*].score", contains(1, 0, 0)))
                .andExpect(jsonPath("$.leaderboard[*].rank", contains(1, 2, 2)));

        score(host, gameId, 1, 2, PLAYERS, answers("p1:2", "p2:2", "p3:3"))
                .andExpect(jsonPath("$.leaderboard[*].score", contains(2, 1, 0)));

        score(host, gameId, 2, 0, PLAYERS, answers("p2:0", "p3:0"))
                .andExpect(jsonPath("$.leaderboard[*].nickname", contains("Alice", "bob", "Cara")))
                .andExpect(jsonPath("$.leaderboard[*].score", contains(2, 2, 1)))
                .andExpect(jsonPath("$.leaderboard[*].rank", contains(1, 1, 3)));

        send(get("/api/games/" + gameId + "/results"), host, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.quizTitle").value("Capitals"))
                .andExpect(jsonPath("$.finished").value(false))
                .andExpect(jsonPath("$.finishedAt").doesNotExist())
                .andExpect(jsonPath("$.questionsScored").value(3))
                .andExpect(jsonPath("$.scoreboard[*].score", contains(2, 2, 1)));
    }

    @Test
    void repeatingAScoreRequestAddsNoPoints() throws Exception {
        score(host, gameId, 0, 1, PLAYERS, answers("p1:1")).andExpect(status().isOk());
        score(host, gameId, 0, 1, PLAYERS, answers("p1:1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.leaderboard[*].score", contains(1, 0, 0)));
        score(host, gameId, 0, 2, PLAYERS, answers("p1:2", "p2:2", "p3:2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.leaderboard[*].score", contains(1, 0, 0)));

        send(get("/api/games/" + gameId + "/results"), host, null)
                .andExpect(jsonPath("$.questionsScored").value(1));
    }

    @Test
    void concurrentDuplicateScoreRequestsScoreOnce() throws Exception {
        scoreConcurrently(0, answers("p1:1", "p2:1", "p3:0"));
        scoreConcurrently(1, answers("p1:1", "p2:0", "p3:1"));

        send(get("/api/games/" + gameId + "/results"), host, null)
                .andExpect(jsonPath("$.questionsScored").value(2))
                .andExpect(jsonPath("$.scoreboard[*].playerId", contains("p1", "p2", "p3")))
                .andExpect(jsonPath("$.scoreboard[*].score", contains(2, 1, 1)));
    }

    @Test
    void theDatabaseRejectsScoringAQuestionTwice() throws Exception {
        score(host, gameId, 0, 1, PLAYERS, answers()).andExpect(status().isOk());
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "insert into scored_question (game_id, question_index) values (?, 0)", UUID.fromString(gameId)));
    }

    private void scoreConcurrently(int questionIndex, String answers) throws Exception {
        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> statuses = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            Callable<Integer> call = () -> {
                start.await();
                return score(host, gameId, questionIndex, 1, PLAYERS, answers).andReturn().getResponse().getStatus();
            };
            statuses.add(pool.submit(call));
        }
        start.countDown();
        for (Future<Integer> status : statuses) {
            assertEquals(200, status.get());
        }
        pool.shutdown();
    }

    @Test
    void lateJoinerHasZeroForEarlierQuestions() throws Exception {
        score(host, gameId, 0, 3, players("p1:Alice"), answers("p1:3")).andExpect(status().isOk());
        score(host, gameId, 1, 0, players("p1:Renamed", "p9:Zed"), answers("p1:0", "p9:0"))
                .andExpect(jsonPath("$.leaderboard[*].nickname", contains("Alice", "Zed")))
                .andExpect(jsonPath("$.leaderboard[*].score", contains(2, 1)))
                .andExpect(jsonPath("$.leaderboard[*].rank", contains(1, 2)));
    }

    @Test
    void finishedGamesAreFrozenAndListedNewestFirst() throws Exception {
        score(host, gameId, 0, 1, PLAYERS, answers("p1:1")).andExpect(status().isOk());

        String first = finish(host, gameId, players("p1:Alice", "p4:Dan"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.finished").value(true))
                .andExpect(jsonPath("$.questionsScored").value(1))
                .andExpect(jsonPath("$.scoreboard[*].playerId", contains("p1", "p2", "p3", "p4")))
                .andExpect(jsonPath("$.scoreboard[*].rank", contains(1, 2, 2, 2)))
                .andReturn().getResponse().getContentAsString();
        String finishedAt = JsonPath.read(first, "$.finishedAt");

        score(host, gameId, 1, 1, PLAYERS, answers("p2:1"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("Game is already finished"));

        Thread.sleep(5);
        String second = finish(host, gameId, players("p5:Eve")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertEquals(first, second);
        send(get("/api/games/" + gameId + "/results"), host, null)
                .andExpect(jsonPath("$.finishedAt").value(finishedAt))
                .andExpect(jsonPath("$.scoreboard.length()").value(4));

        String laterGame = UUID.randomUUID().toString();
        finish(host, laterGame, players()).andExpect(status().isOk());
        score(host, UUID.randomUUID().toString(), 0, 0, PLAYERS, answers()).andExpect(status().isOk());

        send(get("/api/games"), host, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].gameId").value(laterGame))
                .andExpect(jsonPath("$[0].playerCount").value(0))
                .andExpect(jsonPath("$[1].gameId").value(gameId))
                .andExpect(jsonPath("$[1].quizTitle").value("Capitals"))
                .andExpect(jsonPath("$[1].finishedAt").value(finishedAt))
                .andExpect(jsonPath("$[1].playerCount").value(4));
    }

    @Test
    void finishingWithoutScoredQuestionsGivesEveryoneZeroAndFirstPlace() throws Exception {
        finish(host, gameId, PLAYERS)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.questionsScored").value(0))
                .andExpect(jsonPath("$.scoreboard[*].score", contains(0, 0, 0)))
                .andExpect(jsonPath("$.scoreboard[*].rank", contains(1, 1, 1)));
    }

    @Test
    void otherHostsCannotSeeOrChangeAGame() throws Exception {
        score(host, gameId, 0, 1, PLAYERS, answers("p1:1")).andExpect(status().isOk());

        score(otherHost, gameId, 1, 1, PLAYERS, answers("p2:1"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail").value("Game not found"));
        finish(otherHost, gameId, PLAYERS).andExpect(status().isNotFound());
        send(get("/api/games/" + gameId + "/results"), otherHost, null).andExpect(status().isNotFound());

        finish(host, gameId, PLAYERS).andExpect(status().isOk());
        send(get("/api/games"), otherHost, null).andExpect(jsonPath("$.length()").value(0));
        send(get("/api/games/" + gameId + "/results"), host, null)
                .andExpect(jsonPath("$.scoreboard[*].score", contains(1, 0, 0)));
        send(get("/api/games/" + UUID.randomUUID() + "/results"), host, null).andExpect(status().isNotFound());

        mvc.perform(get("/api/games")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/games/" + gameId + "/finish")
                .contentType(MediaType.APPLICATION_JSON).content(finishBody(PLAYERS)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void invalidRequestsAreRejectedWithoutCreatingTheGame() throws Exception {
        expectBadRequest(score(host, gameId, 0, 1, players("p1:Alice", "p1:Again"), answers()),
                "Duplicate participant p1");
        expectBadRequest(score(host, gameId, 0, 1, PLAYERS, answers("p1:1", "p1:2")),
                "Duplicate answer from player p1");
        expectBadRequest(score(host, gameId, 0, 1, PLAYERS, answers("p7:1")), "Answer from unknown player p7");
        expectBadRequest(score(host, gameId, 0, 4, PLAYERS, answers()), "correctIndex must be between 0 and 3");
        expectBadRequest(score(host, gameId, 0, 1, PLAYERS, answers("p1:-1")), "optionIndex must be between 0 and 3");
        expectBadRequest(score(host, gameId, 100, 1, PLAYERS, answers()), "questionIndex must be between 0 and 99");
        expectBadRequest(score(host, gameId, -1, 1, PLAYERS, answers()), "questionIndex must be between 0 and 99");
        expectBadRequest(score(host, gameId, 0, 1, players("p1: "), answers()), "nickname must not be empty");
        expectBadRequest(send(post("/api/games/" + gameId + "/finish"), host, "{\"quizTitle\": \" \", \"participants\": []}"),
                "quizTitle must not be empty");
        expectBadRequest(send(post("/api/games/" + gameId + "/finish"), host, "{\"quizTitle\": \"Capitals\"}"),
                "participants are required");
        expectBadRequest(send(post("/api/games/" + gameId + "/questions/0/score"), host,
                "{\"quizTitle\": \"Capitals\", \"participants\": [], \"answers\": []}"),
                "correctIndex must be between 0 and 3");

        send(post("/api/games/" + gameId + "/questions/0/score"), host, "{\"quizTitle\": ")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").exists());
        send(post("/api/games/" + gameId + "/questions/0/score"), host, "{\"correctIndex\": \"x\"}")
                .andExpect(status().isBadRequest());
        score(host, gameId, 0, 1, PLAYERS, answers("p1:1.5")).andExpect(status().isBadRequest());
        send(post("/api/games/" + gameId + "/questions/0/score"), host,
                "{\"quizTitle\": \"Capitals\", \"correctIndex\": 1.9, \"participants\": " + PLAYERS
                        + ", \"answers\": " + answers("p1:1") + "}")
                .andExpect(status().isBadRequest());
        send(post("/api/games/not-a-uuid/finish"), host, finishBody(PLAYERS)).andExpect(status().isBadRequest());
        send(post("/api/games/" + gameId + "/questions/abc/score"), host, "{}").andExpect(status().isBadRequest());

        send(get("/api/games/" + gameId + "/results"), host, null).andExpect(status().isNotFound());
    }

    @Test
    void controlCharactersAreNeverStoredAsEmptyNames() throws Exception {
        send(post("/api/games/" + gameId + "/finish"), host,
                "{\"quizTitle\": \"\\u0000\", \"participants\": " + players("p1:\\u0001") + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.quizTitle").value("\u0000"))
                .andExpect(jsonPath("$.scoreboard[0].nickname").value("\u0001"));
    }

    @Test
    void onlyTokensFromAccountsForThisServiceAreAccepted() throws Exception {
        mvc.perform(get("/api/games").header("Authorization", "Bearer " + token("quizroom-accounts", "quizroom-scoring")))
                .andExpect(status().isOk());
        mvc.perform(get("/api/games").header("Authorization", "Bearer " + token("quizroom-accounts", "quizroom-other")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/games").header("Authorization", "Bearer " + token("someone-else", "quizroom-scoring")))
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

    private void expectBadRequest(ResultActions result, String detail) throws Exception {
        result.andExpect(status().isBadRequest()).andExpect(jsonPath("$.detail").value(detail));
    }

    private ResultActions score(String owner, String game, int index, int correctIndex, String participants,
                                String answers) throws Exception {
        return send(post("/api/games/" + game + "/questions/" + index + "/score"), owner,
                "{\"quizTitle\": \"Capitals\", \"correctIndex\": " + correctIndex
                        + ", \"participants\": " + participants + ", \"answers\": " + answers + "}");
    }

    private ResultActions finish(String owner, String game, String participants) throws Exception {
        return send(post("/api/games/" + game + "/finish"), owner, finishBody(participants));
    }

    private static String finishBody(String participants) {
        return "{\"quizTitle\": \"Capitals\", \"participants\": " + participants + "}";
    }

    private static String players(String... entries) {
        return json(entries, "playerId", "nickname", true);
    }

    private static String answers(String... entries) {
        return json(entries, "playerId", "optionIndex", false);
    }

    private static String json(String[] entries, String key, String valueKey, boolean quoted) {
        List<String> items = new ArrayList<>();
        for (String entry : entries) {
            String[] parts = entry.split(":", 2);
            String value = quoted ? "\"" + parts[1] + "\"" : parts[1];
            items.add("{\"" + key + "\": \"" + parts[0] + "\", \"" + valueKey + "\": " + value + "}");
        }
        return "[" + String.join(", ", items) + "]";
    }

    private ResultActions send(MockHttpServletRequestBuilder request, String owner, String json) throws Exception {
        request.with(jwt().jwt(j -> j.subject(owner)));
        if (json != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(json);
        }
        return mvc.perform(request);
    }
}
