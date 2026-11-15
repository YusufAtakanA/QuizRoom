package com.quizroom.accounts;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api")
public class AuthController {

    public record RegisterRequest(
            @NotBlank @Email String email,
            @NotBlank @Size(min = 8, max = 100) String password,
            @NotBlank @Size(max = 50) String displayName) {
    }

    public record LoginRequest(@NotBlank String email, @NotBlank String password) {
    }

    public record HostResponse(UUID id, String email, String displayName) {
        static HostResponse of(Host host) {
            return new HostResponse(host.id(), host.email(), host.displayName());
        }
    }

    public record TokenResponse(String accessToken, String tokenType, long expiresIn) {
    }

    private final AccountService accounts;

    public AuthController(AccountService accounts) {
        this.accounts = accounts;
    }

    @PostMapping("/auth/register")
    @ResponseStatus(HttpStatus.CREATED)
    public HostResponse register(@Valid @RequestBody RegisterRequest body) {
        return HostResponse.of(accounts.register(body.email(), body.password(), body.displayName()));
    }

    @PostMapping("/auth/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest body) {
        String token = accounts.login(body.email(), body.password());
        return new TokenResponse(token, "Bearer", accounts.tokenTtl().toSeconds());
    }

    @GetMapping("/accounts/me")
    public HostResponse me(@AuthenticationPrincipal Jwt jwt) {
        return HostResponse.of(accounts.getHost(UUID.fromString(jwt.getSubject())));
    }
}
