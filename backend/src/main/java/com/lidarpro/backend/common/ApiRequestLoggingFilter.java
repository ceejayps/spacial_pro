package com.lidarpro.backend.common;

import java.io.IOException;
import java.util.UUID;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ApiRequestLoggingFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(ApiRequestLoggingFilter.class);
    private static final String REQUEST_ID_HEADER = "X-Request-Id";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
        throws ServletException, IOException {

        long startedAt = System.nanoTime();
        String requestId = resolveRequestId(request);
        response.setHeader(REQUEST_ID_HEADER, requestId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            long durationMs = (System.nanoTime() - startedAt) / 1_000_000;
            log.info(
                "http_interaction requestId={} method={} path={} status={} durationMs={} user={} ip={} userAgent={}",
                requestId,
                request.getMethod(),
                requestUri(request),
                response.getStatus(),
                durationMs,
                currentUser(),
                request.getRemoteAddr(),
                sanitize(request.getHeader("User-Agent"))
            );
        }
    }

    private String resolveRequestId(HttpServletRequest request) {
        String headerValue = request.getHeader(REQUEST_ID_HEADER);
        if (StringUtils.hasText(headerValue)) {
            return headerValue.trim();
        }

        return UUID.randomUUID().toString();
    }

    private String requestUri(HttpServletRequest request) {
        String query = request.getQueryString();
        return StringUtils.hasText(query) ? request.getRequestURI() + "?" + query : request.getRequestURI();
    }

    private String currentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return "anonymous";
        }

        return sanitize(authentication.getName());
    }

    private String sanitize(String value) {
        if (!StringUtils.hasText(value)) {
            return "-";
        }

        return value.replaceAll("[\\r\\n\\t]+", " ").trim();
    }
}
