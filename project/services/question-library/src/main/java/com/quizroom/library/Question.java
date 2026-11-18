package com.quizroom.library;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Entity
public class Question {

    public enum Status { DRAFT, APPROVED }

    @Id
    UUID id = UUID.randomUUID();

    @Version
    Long version;

    @ManyToOne(optional = false)
    Quiz quiz;

    @Column(name = "question_text", nullable = false, length = 1000)
    String text;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "question_options")
    @OrderColumn(name = "option_index")
    @Column(name = "option_text", nullable = false)
    List<String> options = new ArrayList<>();

    @Column(nullable = false)
    int correctIndex;

    @Column(length = 2000)
    String explanation;

    @Column(length = 2000)
    String sourceExcerpt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    Status status = Status.DRAFT;

    @Column(nullable = false)
    Instant createdAt = Instant.now();

    protected Question() {
    }

    Question(Quiz quiz) {
        this.quiz = quiz;
    }

    void setContent(String text, List<String> options, int correctIndex, String explanation) {
        this.text = text.trim();
        this.options = new ArrayList<>(options.stream().map(String::trim).toList());
        this.correctIndex = correctIndex;
        this.explanation = explanation == null || explanation.isBlank() ? null : explanation.trim();
        this.status = Status.DRAFT;
    }

    static String problem(String text, List<String> options, Integer correctIndex, String explanation) {
        if (text == null || text.isBlank()) return "Question text must not be empty";
        if (text.length() > 1000) return "Question text is longer than 1000 characters";
        if (options == null || options.size() != 4) return "A question needs exactly four options";
        for (String option : options) {
            if (option == null || option.isBlank()) return "Options must not be empty";
            if (option.length() > 255) return "Options must be at most 255 characters";
        }
        long distinct = options.stream().map(o -> o.trim().toLowerCase(Locale.ROOT)).distinct().count();
        if (distinct != 4) return "The four options must be different";
        if (correctIndex == null || correctIndex < 0 || correctIndex > 3) return "correctIndex must be between 0 and 3";
        if (explanation != null && explanation.length() > 2000) return "Explanation is longer than 2000 characters";
        return null;
    }
}
