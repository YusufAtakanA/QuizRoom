package com.quizroom.scoring;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.util.UUID;

@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"game_id", "player_id"}))
public class Participant {

    @Id
    UUID id = UUID.randomUUID();

    @ManyToOne(optional = false)
    @JoinColumn(name = "game_id")
    Game game;

    @Column(name = "player_id", nullable = false, length = 64)
    String playerId;

    @Column(nullable = false, length = 50)
    String nickname;

    @Column(nullable = false)
    int score;

    protected Participant() {
    }

    Participant(Game game, String playerId, String nickname) {
        this.game = game;
        this.playerId = playerId;
        this.nickname = nickname;
    }
}
