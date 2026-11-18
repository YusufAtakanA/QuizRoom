package com.quizroom.accounts;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "quizroom.jwt.secret=test-secret-that-is-at-least-32-bytes-long")
@AutoConfigureMockMvc
class AccountsApiTest {

    @Autowired
    MockMvc mvc;

    @Test
    void registerLoginAndReadOwnAccount() throws Exception {
        postJson("/api/auth/register", """
                {"email": "Host@Example.com", "password": "secret123", "displayName": "Ada"}""")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value("host@example.com"))
                .andExpect(jsonPath("$.password").doesNotExist());

        postJson("/api/auth/register", """
                {"email": "host@example.com", "password": "other1234", "displayName": "Bob"}""")
                .andExpect(status().isConflict());

        postJson("/api/auth/login", """
                {"email": "host@example.com", "password": "wrong-pass"}""")
                .andExpect(status().isUnauthorized());

        String body = postJson("/api/auth/login", """
                {"email": "HOST@example.com", "password": "secret123"}""")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andReturn().getResponse().getContentAsString();
        String token = JsonPath.read(body, "$.accessToken");

        mvc.perform(get("/api/accounts/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Ada"));

        mvc.perform(get("/api/accounts/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/accounts/me").header("Authorization", "Bearer " + token + "x"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsInvalidRegistration() throws Exception {
        postJson("/api/auth/register", """
                {"email": "not-an-email", "password": "short", "displayName": ""}""")
                .andExpect(status().isBadRequest());
    }

    @Test
    void unknownEmailGetsSameErrorAsWrongPassword() throws Exception {
        postJson("/api/auth/login", """
                {"email": "nobody@example.com", "password": "secret123"}""")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail").value("Invalid email or password"));
    }

    private ResultActions postJson(String path, String json) throws Exception {
        return mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(json));
    }
}
