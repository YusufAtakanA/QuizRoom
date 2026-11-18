package com.quizroom.scoring;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GameRepository extends JpaRepository<Game, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from Game g where g.id = :id")
    Optional<Game> lockById(UUID id);

    Optional<Game> findByIdAndOwnerId(UUID id, UUID ownerId);

    List<Game> findByOwnerIdAndFinishedAtNotNullOrderByFinishedAtDesc(UUID ownerId);
}
