package com.lidarpro.backend.security;

import java.io.IOException;
import java.util.List;

import com.lidarpro.backend.user.AppUserEntity;
import com.lidarpro.backend.user.AppUserRepository;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final AppUserRepository appUserRepository;

    public JwtAuthenticationFilter(JwtService jwtService, AppUserRepository appUserRepository) {
        this.jwtService = jwtService;
        this.appUserRepository = appUserRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
        throws ServletException, IOException {

        String authHeader = request.getHeader("Authorization");

        if (!StringUtils.hasText(authHeader) || !authHeader.startsWith("Bearer ")) {
            filterChain.doFilter(request, response);
            return;
        }

        String token = authHeader.substring(7).trim();
        AppUserPrincipal tokenPrincipal = jwtService.parsePrincipal(token);

        if (tokenPrincipal == null || SecurityContextHolder.getContext().getAuthentication() != null) {
            filterChain.doFilter(request, response);
            return;
        }

        AppUserEntity user = appUserRepository.findById(tokenPrincipal.userId()).orElse(null);
        if (user == null) {
            filterChain.doFilter(request, response);
            return;
        }

        AppUserPrincipal principal = new AppUserPrincipal(user.getId(), user.getEmail(), user.getFullName());
        UsernamePasswordAuthenticationToken authentication =
            new UsernamePasswordAuthenticationToken(principal, null, List.of());
        authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

        SecurityContextHolder.getContext().setAuthentication(authentication);
        filterChain.doFilter(request, response);
    }
}
