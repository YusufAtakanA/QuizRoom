package com.quizroom.accounts;

import java.util.UUID;

public record Host(UUID id, String email, String password, String displayName) {
}
