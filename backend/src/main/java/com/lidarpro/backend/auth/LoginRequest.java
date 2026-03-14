package com.lidarpro.backend.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class LoginRequest {

    @NotBlank(message = "email is required")
    @Email(message = "email must be valid")
    @Size(max = 320, message = "email is too long")
    private String email;

    @NotBlank(message = "password is required")
    @Size(min = 8, max = 120, message = "password must be between 8 and 120 characters")
    private String password;

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }
}
