package com.example.filerouter.discovery;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import javax.annotation.PreDestroy;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
import java.util.stream.Collectors;

@Component
@EnableConfigurationProperties(DiscoveryProperties.class)
public class DiscoveryReporter {
    private static final Logger LOG = LoggerFactory.getLogger(DiscoveryReporter.class);
    private final DiscoveryProperties properties;
    private final ObjectMapper mapper;
    private final Environment environment;
    private final LongSupplier nanoTime;
    private AddressSource addressSource;
    private Sender sender;
    private List<String> lastAddresses = List.of();
    private long lastSuccess;
    private boolean failed;
    private volatile boolean closed;
    private ScheduledExecutorService executor;

    @Autowired
    public DiscoveryReporter(DiscoveryProperties properties, ObjectMapper mapper, Environment environment) {
        this(properties, mapper, environment, System::nanoTime);
    }

    DiscoveryReporter(DiscoveryProperties properties, ObjectMapper mapper, Environment environment,
                      LongSupplier nanoTime) {
        this.properties = properties;
        this.mapper = mapper;
        this.environment = environment;
        this.nanoTime = nanoTime;
    }

    @EventListener
    public void onReady(ApplicationReadyEvent event) {
        if (!enabled()) {
            LOG.info("Discovery reporting disabled (empty server URL or negative report interval)");
            return;
        }
        if (executor != null || closed
                || !(event.getApplicationContext() instanceof ServletWebServerApplicationContext)) {
            return;
        }
        URI endpoint = heartbeatEndpoint(properties.getServerUrl());
        ServletWebServerApplicationContext context = (ServletWebServerApplicationContext) event.getApplicationContext();
        int port = context.getWebServer().getPort();
        addressSource = () -> properties.getAddress().isBlank()
                ? LocalServiceAddress.resolve(port, context.getServletContext().getContextPath(),
                        environment.getProperty("server.address", ""),
                        environment.getProperty("server.ssl.enabled", Boolean.class, false))
                : List.of(LocalServiceAddress.httpUri(properties.getAddress()).toASCIIString());
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        sender = (addresses, interval) -> send(client, endpoint, addresses, interval);
        executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "file-router-discovery");
            thread.setDaemon(true);
            return thread;
        });
        LOG.info("Discovery reporting enabled; interval: {}s, local IP check: at most 30s",
                properties.getReportIntervalSeconds());
        executor.execute(this::runScheduledCheck);
    }

    boolean enabled() {
        return !properties.getServerUrl().isBlank() && properties.getReportIntervalSeconds() > 0;
    }

    private void runScheduledCheck() {
        if (closed) {
            return;
        }
        long delay = checkAndReport(addressSource, sender);
        if (!closed) {
            executor.schedule(this::runScheduledCheck, delay, TimeUnit.NANOSECONDS);
        }
    }

    // The return value schedules the earlier of the next local IP check and heartbeat.
    long checkAndReport(AddressSource source, Sender target) {
        long interval = TimeUnit.SECONDS.toNanos(properties.getReportIntervalSeconds());
        long localCheck = Math.min(TimeUnit.SECONDS.toNanos(30), interval);
        if (closed || !enabled()) {
            return TimeUnit.SECONDS.toNanos(30);
        }
        try {
            List<String> addresses = source.get().stream().distinct().sorted().collect(Collectors.toList());
            if (addresses.isEmpty()) {
                throw new IllegalStateException("No service addresses available");
            }
            if (!addresses.equals(lastAddresses) || nanoTime.getAsLong() - lastSuccess >= interval) {
                target.send(addresses, properties.getReportIntervalSeconds());
                if (!addresses.equals(lastAddresses) || failed) {
                    LOG.info("Discovery addresses reported: {}", addresses);
                }
                lastAddresses = addresses;
                lastSuccess = nanoTime.getAsLong();
                failed = false;
            }
            return Math.max(1, Math.min(localCheck, interval - (nanoTime.getAsLong() - lastSuccess)));
        } catch (Exception exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            if (!closed && !failed) {
                LOG.warn("Discovery report failed; retrying in at most 30s: {}", exception.toString());
            }
            failed = true;
            return localCheck;
        }
    }

    static URI heartbeatEndpoint(String serverUrl) {
        URI base = LocalServiceAddress.httpUri(serverUrl);
        if (base.getRawQuery() != null || base.getRawFragment() != null) {
            throw new IllegalArgumentException("discovery.server-url must not contain a query or fragment");
        }
        return URI.create(base.toASCIIString().replaceAll("/+$", "") + "/api/heartbeat");
    }

    void send(HttpClient client, URI endpoint, List<String> addresses, int interval) throws Exception {
        // The legacy field lets older discovery servers still display the first address.
        String body = mapper.writeValueAsString(Map.of("address", addresses.get(0), "addresses", addresses,
                "reportIntervalSeconds", interval));
        HttpRequest request = HttpRequest.newBuilder(endpoint).version(HttpClient.Version.HTTP_1_1)
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<Void> response = client.send(request, HttpResponse.BodyHandlers.discarding());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IOException("Discovery server returned HTTP " + response.statusCode());
        }
    }

    @PreDestroy
    public void close() {
        closed = true;
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    @FunctionalInterface
    interface AddressSource {
        List<String> get() throws Exception;
    }

    @FunctionalInterface
    interface Sender {
        void send(List<String> addresses, int interval) throws Exception;
    }
}
