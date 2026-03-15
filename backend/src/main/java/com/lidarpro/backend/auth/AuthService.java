package com.lidarpro.backend.auth;

import java.util.Locale;
import java.util.UUID;

import com.lidarpro.backend.common.NotFoundException;
import com.lidarpro.backend.security.AppUserPrincipal;
import com.lidarpro.backend.security.JwtService;
import com.lidarpro.backend.user.AppUserEntity;
import com.lidarpro.backend.user.AppUserRepository;
import com.lidarpro.backend.user.UserProfileResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
@Transactional
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final AppUserRepository appUserRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(
        AppUserRepository appUserRepository,
        PasswordEncoder passwordEncoder,
        JwtService jwtService
    ) {
        this.appUserRepository = appUserRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    public AuthResponse register(RegisterRequest request) {
        String email = normalizeEmail(request.getEmail());
        String fullName = normalizeName(request.getFullName());
        String password = String.valueOf(request.getPassword());

        if (appUserRepository.existsByEmail(email)) {
            log.warn("auth_register_rejected email={} reason=already_registered", email);
            throw new IllegalArgumentException("Email is already registered.");
        }

        AppUserEntity user = new AppUserEntity();
        user.setEmail(email);
        user.setFullName(fullName);
        user.setPasswordHash(passwordEncoder.encode(password));

        AppUserEntity saved = appUserRepository.save(user);
        String token = jwtService.issueAccessToken(saved);
        log.info("auth_register_success userId={} email={}", saved.getId(), saved.getEmail());

        return AuthResponse.bearer(token, UserProfileResponse.fromEntity(saved));
    }

    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest request) {
        String email = normalizeEmail(request.getEmail());
        String password = String.valueOf(request.getPassword());

        AppUserEntity user = appUserRepository.findByEmail(email).orElse(null);

        if (user == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
            log.warn("auth_login_failed email={}", email);
            throw new IllegalArgumentException("Invalid email or password.");
        }

        String token = jwtService.issueAccessToken(user);
        log.info("auth_login_success userId={} email={}", user.getId(), user.getEmail());
        return AuthResponse.bearer(token, UserProfileResponse.fromEntity(user));
    }

    @Transactional(readOnly = true)
    public UserProfileResponse me(AppUserPrincipal principal) {
        AppUserEntity user = findById(requirePrincipal(principal).userId());
        log.info("auth_me userId={} email={}", user.getId(), user.getEmail());
        return UserProfileResponse.fromEntity(user);
    }

    public UserProfileResponse updateProfile(AppUserPrincipal principal, UpdateProfileRequest request) {
        AppUserEntity user = findById(requirePrincipal(principal).userId());
        user.setFullName(normalizeName(request.getFullName()));
        AppUserEntity saved = appUserRepository.save(user);
        log.info("auth_profile_updated userId={} email={}", saved.getId(), saved.getEmail());
        return UserProfileResponse.fromEntity(saved);
    }

    @Transactional(readOnly = true)
    public AppUserEntity findById(UUID userId) {
        return appUserRepository.findById(userId)
            .orElseThrow(() -> new NotFoundException("User not found."));
    }

    private String normalizeEmail(String email) {
        String value = String.valueOf(email).trim().toLowerCase(Locale.ROOT);

        if (!StringUtils.hasText(value)) {
            throw new IllegalArgumentException("Email is required.");
        }

        return value;
    }

    private String normalizeName(String fullName) {
        String value = String.valueOf(fullName).trim();

        if (!StringUtils.hasText(value)) {
            throw new IllegalArgumentException("Full name is required.");
        }

        return value;
    }

    private AppUserPrincipal requirePrincipal(AppUserPrincipal principal) {
        if (principal == null || principal.userId() == null) {
            throw new AuthenticationCredentialsNotFoundException("Authenticated user is required.");
        }

        return principal;
    }
}
