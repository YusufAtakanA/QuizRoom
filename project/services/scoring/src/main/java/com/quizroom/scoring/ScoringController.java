package com.quizroom.scoring;

import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

@RestController
@RequestMapping("/api/games")
public class ScoringController {

    public record Leaderboard(UUID gameId, int questionIndex, List<ScoringService.Standing> leaderboard) {
    }

    public record Results(UUID gameId, String quizTitle, boolean finished, Instant finishedAt, int questionsScored,
                          List<ScoringService.Standing> scoreboard) {
    }

    public record GameSummary(UUID gameId, String quizTitle, Instant finishedAt, int playerCount) {
    }

    private final ScoringService service;

    public ScoringController(ScoringService service) {
        this.service = service;
    }

    @PostMapping("/{gameId}/questions/{questionIndex}/score")
    public Leaderboard score(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID gameId,
                             @PathVariable int questionIndex, @RequestBody ScoringService.ScoreRequest body) {
        Game game = retryOnce(() -> service.score(owner(jwt), gameId, questionIndex, body));
        return new Leaderboard(game.id, questionIndex, ScoringService.rank(game.participants));
    }

    @PostMapping("/{gameId}/finish")
    public Results finish(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID gameId,
                          @RequestBody ScoringService.FinishRequest body) {
        return results(retryOnce(() -> service.finish(owner(jwt), gameId, body)));
    }

    @GetMapping
    public List<GameSummary> list(@AuthenticationPrincipal Jwt jwt) {
        return service.finished(owner(jwt)).stream()
                .map(g -> new GameSummary(g.id, g.quizTitle, g.finishedAt, g.participants.size()))
                .toList();
    }

    @GetMapping("/{gameId}/results")
    public Results results(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID gameId) {
        return results(service.results(owner(jwt), gameId));
    }

    private static Game retryOnce(Supplier<Game> action) {
        try {
            return action.get();
        } catch (DataIntegrityViolationException | ConcurrencyFailureException e) {
            return action.get();
        }
    }

    private static UUID owner(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }

    private static Results results(Game game) {
        return new Results(game.id, game.quizTitle, game.finishedAt != null, game.finishedAt,
                game.scoredQuestions.size(), ScoringService.rank(game.participants));
    }
}
