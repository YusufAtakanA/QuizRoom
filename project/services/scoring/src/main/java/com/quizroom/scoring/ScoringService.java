package com.quizroom.scoring;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

@Service
@Transactional
public class ScoringService {

    public record PlayerInput(String playerId, String nickname) {
    }

    public record AnswerInput(String playerId, Integer optionIndex) {
    }

    public record ScoreRequest(String quizTitle, Integer correctIndex, List<PlayerInput> participants,
                               List<AnswerInput> answers) {
    }

    public record FinishRequest(String quizTitle, List<PlayerInput> participants) {
    }

    public record Standing(String playerId, String nickname, int score, int rank) {
    }

    private final GameRepository games;

    public ScoringService(GameRepository games) {
        this.games = games;
    }

    public Game score(UUID owner, UUID gameId, int questionIndex, ScoreRequest request) {
        reject(scoreProblem(questionIndex, request));
        Game game = lockOrCreate(owner, gameId, request.quizTitle());
        if (game.finishedAt != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Game is already finished");
        }
        if (game.scoredQuestions.contains(questionIndex)) {
            return game;
        }
        game.addParticipants(request.participants());
        Map<String, Integer> chosen = new HashMap<>();
        request.answers().forEach(a -> chosen.put(a.playerId(), a.optionIndex()));
        for (Participant participant : game.participants) {
            if (Objects.equals(chosen.get(participant.playerId), request.correctIndex())) {
                participant.score++;
            }
        }
        game.scoredQuestions.add(questionIndex);
        games.flush();
        return game;
    }

    public Game finish(UUID owner, UUID gameId, FinishRequest request) {
        reject(playersProblem(request.quizTitle(), request.participants()));
        Game game = lockOrCreate(owner, gameId, request.quizTitle());
        if (game.finishedAt != null) {
            return game;
        }
        game.addParticipants(request.participants());
        game.finishedAt = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        games.flush();
        return game;
    }

    @Transactional(readOnly = true)
    public List<Game> finished(UUID owner) {
        return games.findByOwnerIdAndFinishedAtNotNullOrderByFinishedAtDesc(owner);
    }

    @Transactional(readOnly = true)
    public Game results(UUID owner, UUID gameId) {
        return games.findByIdAndOwnerId(gameId, owner).orElseThrow(ScoringService::notFound);
    }

    static List<Standing> rank(Collection<Participant> participants) {
        List<Participant> sorted = participants.stream()
                .sorted(Comparator.comparingInt((Participant p) -> -p.score)
                        .thenComparing(p -> p.nickname, String.CASE_INSENSITIVE_ORDER)
                        .thenComparing(p -> p.playerId))
                .toList();
        List<Standing> standings = new ArrayList<>();
        for (int i = 0; i < sorted.size(); i++) {
            Participant p = sorted.get(i);
            int rank = i > 0 && sorted.get(i - 1).score == p.score ? standings.get(i - 1).rank() : i + 1;
            standings.add(new Standing(p.playerId, p.nickname, p.score, rank));
        }
        return standings;
    }

    private Game lockOrCreate(UUID owner, UUID gameId, String quizTitle) {
        Game game = games.lockById(gameId).orElseGet(() -> games.save(new Game(gameId, owner, quizTitle.strip())));
        if (!game.ownerId.equals(owner)) {
            throw notFound();
        }
        return game;
    }

    private static String scoreProblem(int questionIndex, ScoreRequest request) {
        if (questionIndex < 0 || questionIndex > 99) return "questionIndex must be between 0 and 99";
        String problem = playersProblem(request.quizTitle(), request.participants());
        if (problem != null) return problem;
        if (request.correctIndex() == null || request.correctIndex() < 0 || request.correctIndex() > 3) {
            return "correctIndex must be between 0 and 3";
        }
        if (request.answers() == null) return "answers are required";
        Set<String> known = new HashSet<>(request.participants().stream().map(PlayerInput::playerId).toList());
        Set<String> answered = new HashSet<>();
        for (AnswerInput answer : request.answers()) {
            if (answer == null || answer.playerId() == null || answer.playerId().isBlank()) {
                return "Answer playerId must not be empty";
            }
            if (answer.optionIndex() == null || answer.optionIndex() < 0 || answer.optionIndex() > 3) {
                return "optionIndex must be between 0 and 3";
            }
            if (!known.contains(answer.playerId())) return "Answer from unknown player " + answer.playerId();
            if (!answered.add(answer.playerId())) return "Duplicate answer from player " + answer.playerId();
        }
        return null;
    }

    private static String playersProblem(String quizTitle, List<PlayerInput> participants) {
        if (quizTitle == null || quizTitle.isBlank()) return "quizTitle must not be empty";
        if (quizTitle.length() > 200) return "quizTitle is longer than 200 characters";
        if (participants == null) return "participants are required";
        Set<String> seen = new HashSet<>();
        for (PlayerInput player : participants) {
            if (player == null || player.playerId() == null || player.playerId().isBlank()) {
                return "playerId must not be empty";
            }
            if (player.playerId().length() > 64) return "playerId is longer than 64 characters";
            if (player.nickname() == null || player.nickname().isBlank()) return "nickname must not be empty";
            if (player.nickname().length() > 50) return "nickname is longer than 50 characters";
            if (!seen.add(player.playerId())) return "Duplicate participant " + player.playerId();
        }
        return null;
    }

    private static void reject(String problem) {
        if (problem != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, problem);
        }
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Game not found");
    }
}
