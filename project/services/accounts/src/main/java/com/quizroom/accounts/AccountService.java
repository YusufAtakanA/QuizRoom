package com.quizroom.accounts;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

@Service
public class AccountService {

    private final HostStore hosts;
    private final JwtEncoder jwtEncoder;
    private final Duration tokenTtl;

    public AccountService(HostStore hosts, JwtEncoder jwtEncoder, @Value("${quizroom.jwt.ttl}") Duration tokenTtl) {
        this.hosts = hosts;
        this.jwtEncoder = jwtEncoder;
        this.tokenTtl = tokenTtl;
    }

    public Host register(String email, String password, String displayName) {
        Host host = new Host(UUID.randomUUID(), normalize(email), password, displayName.trim());
        if (hosts.putIfAbsent(host) != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email already registered");
        }
        return host;
    }

    public String login(String email, String password) {
        Host host = hosts.findByEmail(normalize(email))
                .filter(h -> h.password().equals(password))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password"));

        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .subject(host.id().toString())
                .claim("email", host.email())
                .issuedAt(now)
                .expiresAt(now.plus(tokenTtl))
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    public Host getHost(UUID id) {
        return hosts.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Host not found"));
    }

    public Duration tokenTtl() {
        return tokenTtl;
    }

    private static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
