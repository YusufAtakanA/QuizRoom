package com.quizroom.accounts;

import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Component
public class HostStore {

    private final ConcurrentMap<String, Host> byEmail = new ConcurrentHashMap<>();

    public Host putIfAbsent(Host host) {
        return byEmail.putIfAbsent(host.email(), host);
    }

    public Optional<Host> findByEmail(String email) {
        return Optional.ofNullable(byEmail.get(email));
    }

    public Optional<Host> findById(UUID id) {
        return byEmail.values().stream().filter(h -> h.id().equals(id)).findFirst();
    }
}
