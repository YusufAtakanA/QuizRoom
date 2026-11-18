package com.quizroom.library;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/quizzes")
public class QuizController {

    public record TitleRequest(@NotBlank @Size(max = 200) String title) {
    }

    public record GenerateRequest(@NotBlank @Size(max = 20000) String notes, @Min(1) @Max(10) int count) {
    }

    public record QuizSummary(UUID id, String title, long approvedCount, long draftCount, boolean ready) {
    }

    public record QuestionView(UUID id, String text, List<String> options, int correctIndex,
                               String explanation, String sourceExcerpt, Question.Status status) {
    }

    public record QuizDetail(UUID id, String title, String notes, long approvedCount, long draftCount,
                             boolean ready, List<QuestionView> questions) {
    }

    public record GenerationView(List<QuestionView> created, List<String> rejected) {
    }

    public record SnapshotQuestion(String text, List<String> options, int correctIndex, String explanation) {
    }

    public record Snapshot(UUID quizId, String title, List<SnapshotQuestion> questions) {
    }

    private final QuizService service;

    public QuizController(QuizService service) {
        this.service = service;
    }

    @GetMapping
    public List<QuizSummary> list(@AuthenticationPrincipal Jwt jwt) {
        return service.list(owner(jwt)).stream().map(QuizController::summary).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public QuizDetail create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody TitleRequest body) {
        return detail(service.create(owner(jwt), body.title()));
    }

    @GetMapping("/{quizId}")
    public QuizDetail get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID quizId) {
        return detail(service.get(owner(jwt), quizId));
    }

    @PutMapping("/{quizId}")
    public QuizDetail rename(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID quizId,
                             @Valid @RequestBody TitleRequest body) {
        return detail(service.rename(owner(jwt), quizId, body.title()));
    }

    @DeleteMapping("/{quizId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID quizId) {
        service.delete(owner(jwt), quizId);
    }

    @PostMapping("/{quizId}/questions")
    @ResponseStatus(HttpStatus.CREATED)
    public QuestionView addQuestion(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID quizId,
                                    @RequestBody QuizService.QuestionInput body) {
        return view(service.addQuestion(owner(jwt), quizId, body));
    }

    @PutMapping("/{quizId}/questions/{questionId}")
    public QuestionView updateQuestion(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID quizId,
                                       @PathVariable UUID questionId, @RequestBody QuizService.QuestionInput body) {
        return view(service.updateQuestion(owner(jwt), quizId, questionId, body));
    }

    @PostMapping("/{quizId}/questions/{questionId}/approve")
    public QuestionView approve(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID quizId,
                                @PathVariable UUID questionId) {
        return view(service.approve(owner(jwt), quizId, questionId));
    }

    @DeleteMapping("/{quizId}/questions/{questionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void discard(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID quizId, @PathVariable UUID questionId) {
        service.discard(owner(jwt), quizId, questionId);
    }

    @PostMapping("/{quizId}/generate")
    @ResponseStatus(HttpStatus.CREATED)
    public GenerationView generate(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID quizId,
                                   @Valid @RequestBody GenerateRequest body) {
        QuizService.GenerationResult result = service.generate(owner(jwt), quizId, body.notes(), body.count());
        return new GenerationView(result.created().stream().map(QuizController::view).toList(), result.rejected());
    }

    @GetMapping("/{quizId}/snapshot")
    public Snapshot snapshot(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID quizId) {
        Quiz quiz = service.snapshot(owner(jwt), quizId);
        List<SnapshotQuestion> questions = quiz.approvedQuestions().stream()
                .map(q -> new SnapshotQuestion(q.text, q.options, q.correctIndex, q.explanation))
                .toList();
        return new Snapshot(quiz.id, quiz.title, questions);
    }

    private static UUID owner(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }

    private static QuizSummary summary(Quiz quiz) {
        long approved = quiz.approvedCount();
        return new QuizSummary(quiz.id, quiz.title, approved, quiz.questions.size() - approved, quiz.ready());
    }

    private static QuizDetail detail(Quiz quiz) {
        long approved = quiz.approvedCount();
        return new QuizDetail(quiz.id, quiz.title, quiz.notes, approved, quiz.questions.size() - approved,
                quiz.ready(), quiz.questions.stream().map(QuizController::view).toList());
    }

    private static QuestionView view(Question q) {
        return new QuestionView(q.id, q.text, q.options, q.correctIndex, q.explanation, q.sourceExcerpt, q.status);
    }
}
