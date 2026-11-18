package com.quizroom.scoring;

import jakarta.persistence.CascadeType;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Entity
public class Game {

    @Id
    UUID id;

    @Version
    Long version;

    @Column(nullable = false)
    UUID ownerId;

    @Column(nullable = false, length = 200)
    String quizTitle;

    Instant finishedAt;

    @OneToMany(mappedBy = "game", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    Set<Participant> participants = new HashSet<>();

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "scored_question", joinColumns = @JoinColumn(name = "game_id"),
            uniqueConstraints = @UniqueConstraint(columnNames = {"game_id", "question_index"}))
    @Column(name = "question_index", nullable = false)
    Set<Integer> scoredQuestions = new HashSet<>();

    protected Game() {
    }

    Game(UUID id, UUID ownerId, String quizTitle) {
        this.id = id;
        this.ownerId = ownerId;
        this.quizTitle = quizTitle;
    }

    void addParticipants(List<ScoringService.PlayerInput> players) {
        for (ScoringService.PlayerInput player : players) {
            if (participants.stream().noneMatch(p -> p.playerId.equals(player.playerId()))) {
                participants.add(new Participant(this, player.playerId(), player.nickname().strip()));
            }
        }
    }
}
