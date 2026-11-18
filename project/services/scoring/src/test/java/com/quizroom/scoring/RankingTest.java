package com.quizroom.scoring;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RankingTest {

    @Test
    void equalScoresShareARankAndTheNextRankIsSkipped() {
        List<ScoringService.Standing> standings = ScoringService.rank(List.of(
                player("p3", "cara", 1), player("p2", "Bob", 3), player("p1", "alice", 3)));

        assertEquals(List.of(
                new ScoringService.Standing("p1", "alice", 3, 1),
                new ScoringService.Standing("p2", "Bob", 3, 1),
                new ScoringService.Standing("p3", "cara", 1, 3)), standings);
    }

    @Test
    void allEqualScoresAreAllFirst() {
        List<ScoringService.Standing> standings = ScoringService.rank(List.of(
                player("b", "Sam", 2), player("a", "Sam", 2), player("c", "Ann", 2)));

        assertEquals(List.of("c", "a", "b"), standings.stream().map(ScoringService.Standing::playerId).toList());
        assertEquals(List.of(1, 1, 1), standings.stream().map(ScoringService.Standing::rank).toList());
    }

    @Test
    void noParticipantsGiveAnEmptyRanking() {
        assertEquals(List.of(), ScoringService.rank(List.of()));
    }

    private static Participant player(String playerId, String nickname, int score) {
        Participant participant = new Participant(null, playerId, nickname);
        participant.score = score;
        return participant;
    }
}
