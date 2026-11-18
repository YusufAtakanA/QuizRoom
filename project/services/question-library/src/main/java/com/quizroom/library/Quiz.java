package com.quizroom.library;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
public class Quiz {

    static final int MAX_APPROVED = 10;

    @Id
    UUID id = UUID.randomUUID();

    @Version
    Long version;

    @Column(nullable = false)
    UUID ownerId;

    @Column(nullable = false, length = 200)
    String title;

    @Column(length = 20000)
    String notes;

    @Column(nullable = false)
    Instant createdAt = Instant.now();

    @OneToMany(mappedBy = "quiz", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @OrderBy("createdAt")
    List<Question> questions = new ArrayList<>();

    protected Quiz() {
    }

    Quiz(UUID ownerId, String title) {
        this.ownerId = ownerId;
        this.title = title;
    }

    long approvedCount() {
        return questions.stream().filter(q -> q.status == Question.Status.APPROVED).count();
    }

    boolean ready() {
        long approved = approvedCount();
        return approved >= 1 && approved <= MAX_APPROVED;
    }

    List<Question> approvedQuestions() {
        return questions.stream().filter(q -> q.status == Question.Status.APPROVED).toList();
    }
}
