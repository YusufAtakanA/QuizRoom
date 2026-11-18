package com.quizroom.library;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class QuizService {

    public record QuestionInput(String text, List<String> options, Integer correctIndex, String explanation) {
    }

    public record GenerationResult(List<Question> created, List<String> rejected) {
    }

    private final QuizRepository quizzes;
    private final AiClient ai;

    public QuizService(QuizRepository quizzes, AiClient ai) {
        this.quizzes = quizzes;
        this.ai = ai;
    }

    @Transactional(readOnly = true)
    public List<Quiz> list(UUID owner) {
        return quizzes.findByOwnerIdOrderByCreatedAt(owner);
    }

    public Quiz create(UUID owner, String title) {
        return quizzes.save(new Quiz(owner, title.trim()));
    }

    @Transactional(readOnly = true)
    public Quiz get(UUID owner, UUID quizId) {
        return quizzes.findByIdAndOwnerId(quizId, owner)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Quiz not found"));
    }

    public Quiz rename(UUID owner, UUID quizId, String title) {
        Quiz quiz = get(owner, quizId);
        quiz.title = title.trim();
        return quiz;
    }

    public void delete(UUID owner, UUID quizId) {
        quizzes.delete(get(owner, quizId));
    }

    public Question addQuestion(UUID owner, UUID quizId, QuestionInput input) {
        Quiz quiz = get(owner, quizId);
        Question question = new Question(quiz);
        applyInput(question, input);
        quiz.questions.add(question);
        return question;
    }

    public Question updateQuestion(UUID owner, UUID quizId, UUID questionId, QuestionInput input) {
        Question question = findQuestion(get(owner, quizId), questionId);
        applyInput(question, input);
        return question;
    }

    public Question approve(UUID owner, UUID quizId, UUID questionId) {
        Quiz quiz = get(owner, quizId);
        Question question = findQuestion(quiz, questionId);
        if (question.status == Question.Status.APPROVED) {
            return question;
        }
        if (quiz.approvedCount() >= Quiz.MAX_APPROVED) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "A quiz can have at most " + Quiz.MAX_APPROVED + " approved questions");
        }
        question.status = Question.Status.APPROVED;
        return question;
    }

    public void discard(UUID owner, UUID quizId, UUID questionId) {
        Quiz quiz = get(owner, quizId);
        quiz.questions.remove(findQuestion(quiz, questionId));
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public GenerationResult generate(UUID owner, UUID quizId, String notes, int count) {
        Quiz quiz = get(owner, quizId);
        AiClient.Generation generation = ai.generate(notes, count);

        List<String> rejected = new ArrayList<>();
        if (generation.rejected() != null) {
            generation.rejected().forEach(r -> rejected.add(r.reason()));
        }
        List<Question> created = new ArrayList<>();
        for (AiClient.GeneratedQuestion generated : generation.questions()) {
            String problem = generatedProblem(generated, notes, created.size(), count);
            if (problem != null) {
                rejected.add(problem);
                continue;
            }
            Question question = new Question(quiz);
            question.setContent(generated.text(), generated.options(), generated.correctIndex(), generated.explanation());
            question.sourceExcerpt = generated.sourceExcerpt().trim();
            created.add(question);
        }

        quiz.notes = notes;
        quiz.questions.addAll(created);
        quizzes.save(quiz);
        return new GenerationResult(created, rejected);
    }

    @Transactional(readOnly = true)
    public Quiz snapshot(UUID owner, UUID quizId) {
        Quiz quiz = get(owner, quizId);
        if (!quiz.ready()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Quiz is not ready: it needs 1 to " + Quiz.MAX_APPROVED + " approved questions");
        }
        return quiz;
    }

    private static void applyInput(Question question, QuestionInput input) {
        String problem = Question.problem(input.text(), input.options(), input.correctIndex(), input.explanation());
        if (problem != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, problem);
        }
        question.setContent(input.text(), input.options(), input.correctIndex(), input.explanation());
    }

    private static Question findQuestion(Quiz quiz, UUID questionId) {
        return quiz.questions.stream()
                .filter(q -> q.id.equals(questionId))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found"));
    }

    private static String generatedProblem(AiClient.GeneratedQuestion g, String notes, int accepted, int count) {
        if (accepted >= count) return "More questions than requested";
        String problem = Question.problem(g.text(), g.options(), g.correctIndex(), g.explanation());
        if (problem != null) return problem;
        if (g.explanation() == null || g.explanation().isBlank()) return "Explanation is missing";
        String excerpt = g.sourceExcerpt();
        if (excerpt == null || excerpt.isBlank()) return "Supporting excerpt is missing";
        if (excerpt.length() > 2000) return "Supporting excerpt is longer than 2000 characters";
        if (!collapseSpaces(notes).contains(collapseSpaces(excerpt))) return "Supporting excerpt is not in the notes";
        return null;
    }

    private static String collapseSpaces(String s) {
        return s.replaceAll("\\s+", " ").trim();
    }
}
