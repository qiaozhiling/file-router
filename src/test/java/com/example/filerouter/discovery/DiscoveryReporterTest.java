package com.example.filerouter.discovery;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockServletContext;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.InetAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DiscoveryReporterTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final AtomicLong clock = new AtomicLong();

    private DiscoveryProperties properties(int interval) {
        DiscoveryProperties properties = new DiscoveryProperties();
        properties.setServerUrl("https://discovery.example.test");
        properties.setReportIntervalSeconds(interval);
        return properties;
    }

    private DiscoveryReporter reporter(DiscoveryProperties properties) {
        return new DiscoveryReporter(properties, mapper, new MockEnvironment(), clock::get);
    }

    @Test
    void emptyUrlAndEveryNegativeIntervalDisableAllReporting() {
        for (int interval : new int[]{-1, -60, Integer.MIN_VALUE}) {
            DiscoveryReporter reporter = reporter(properties(interval));
            reporter.onReady(null); // Disabled reporting must not inspect the application or network.
            reporter.checkAndReport(() -> { fail("Must not inspect local IP"); return List.of(); },
                    (address, seconds) -> fail("Must not report"));
            reporter.close();
        }
        DiscoveryProperties properties = properties(300);
        properties.setServerUrl("  ");
        DiscoveryReporter reporter = reporter(properties);
        assertFalse(reporter.enabled());
        reporter.onReady(null);
        reporter.close();
    }

    @Test
    void springBindsHyphenatedSettingsAndRejectsZero() {
        ApplicationContextRunner runner = new ApplicationContextRunner().withUserConfiguration(PropertiesConfig.class);
        runner.withPropertyValues("discovery.report-interval-seconds=600", "discovery.server-url=https://example.test")
                .run(context -> {
                    assertNull(context.getStartupFailure());
                    assertEquals(600, context.getBean(DiscoveryProperties.class).getReportIntervalSeconds());
                    assertEquals("https://example.test", context.getBean(DiscoveryProperties.class).getServerUrl());
                });
        runner.withPropertyValues("discovery.report-interval-seconds=0")
                .run(context -> assertNotNull(context.getStartupFailure()));
    }

    @Test
    void startupIsImmediateAndLocalChecksDoNotSendExtraHeartbeats() {
        DiscoveryReporter reporter = reporter(properties(300));
        List<List<String>> sent = new ArrayList<>();
        assertEquals(TimeUnit.SECONDS.toNanos(30), reporter.checkAndReport(() -> List.of("http://10.13.4.75:8081/"),
                (address, seconds) -> { assertEquals(300, seconds); sent.add(address); }));
        clock.set(TimeUnit.SECONDS.toNanos(299));
        assertEquals(TimeUnit.SECONDS.toNanos(1), reporter.checkAndReport(() -> sent.get(0),
                (address, seconds) -> sent.add(address)));
        assertEquals(1, sent.size());
        clock.set(TimeUnit.SECONDS.toNanos(300));
        reporter.checkAndReport(() -> sent.get(0), (address, seconds) -> sent.add(address));
        assertEquals(2, sent.size());
        reporter.close();
    }

    @Test
    void addressChangesAreReportedBeforeTheHeartbeatAndResetTheTimer() {
        DiscoveryReporter reporter = reporter(properties(600));
        List<List<String>> sent = new ArrayList<>();
        reporter.checkAndReport(() -> List.of("http://10.13.4.75:8081/"), (address, seconds) -> sent.add(address));
        clock.set(TimeUnit.SECONDS.toNanos(30));
        reporter.checkAndReport(() -> List.of("http://10.13.4.88:8081/"), (address, seconds) -> sent.add(address));
        clock.set(TimeUnit.SECONDS.toNanos(600));
        reporter.checkAndReport(() -> List.of("http://10.13.4.88:8081/"), (address, seconds) -> sent.add(address));
        assertEquals(List.of(List.of("http://10.13.4.75:8081/"), List.of("http://10.13.4.88:8081/")), sent);
        clock.set(TimeUnit.SECONDS.toNanos(630));
        reporter.checkAndReport(() -> List.of("http://10.13.4.88:8081/"), (address, seconds) -> sent.add(address));
        assertEquals(3, sent.size());
        reporter.close();
    }

    @Test
    void failedUpdatesRetryWithoutPublishingThemAsSuccessful() {
        DiscoveryReporter reporter = reporter(properties(7));
        assertEquals(TimeUnit.SECONDS.toNanos(7), reporter.checkAndReport(() -> List.of("http://10.13.4.75:8081/"),
                (address, seconds) -> { throw new IOException("offline"); }));
        List<List<String>> sent = new ArrayList<>();
        clock.set(TimeUnit.SECONDS.toNanos(7));
        reporter.checkAndReport(() -> List.of("http://10.13.4.75:8081/"), (address, seconds) -> sent.add(address));
        clock.set(TimeUnit.SECONDS.toNanos(8));
        reporter.checkAndReport(() -> { throw new IOException("no NIC"); },
                (address, seconds) -> fail("No address must not overwrite the registry"));
        assertEquals(1, sent.size());
        reporter.close();
        reporter.checkAndReport(() -> { fail("Closed reporter must not run"); return List.of(); },
                (address, seconds) -> fail("Closed reporter must not report"));
    }

    @Test
    void buildsEndpointUnderConfiguredPrefixAndRejectsInvalidUrls() {
        assertEquals(URI.create("https://example.test/discovery/api/heartbeat"),
                DiscoveryReporter.heartbeatEndpoint("https://example.test/discovery/"));
        for (String invalid : List.of("file:///tmp/test", "http://user:pass@example.test/",
                "http://example.test:0/", "http://example.test:65536/", "https://example.test/?x=1",
                "https://example.test/#fragment", "not a URL")) {
            assertThrows(IllegalArgumentException.class, () -> DiscoveryReporter.heartbeatEndpoint(invalid));
        }
    }

    @Test
    void automaticAddressIncludesActualPortContextPathAndSupportsDotOneAndIpv6() throws Exception {
        assertEquals(List.of("http://10.13.4.1:8090/share/"),
                LocalServiceAddress.resolve(8090, "/share", "10.13.4.1", false));
        assertEquals(List.of("https://[fd00:0:0:0:0:0:0:1]:8443/"),
                LocalServiceAddress.resolve(8443, "", "fd00::1", true));
        assertThrows(IllegalStateException.class,
                () -> LocalServiceAddress.resolve(8081, "", "127.0.0.1", false));
    }

    @Test
    void applicationReadyPostsExpectedJsonToHttpServerAndUsesAdvertisedOverride() throws Exception {
        postOnReady("https://files.example.test/share/", "https://files.example.test/share/");
    }

    @Test
    void applicationReadyUsesActualPortAndContextPathWhenNoAddressOverrideIsSet() throws Exception {
        postOnReady("", "http://10.13.4.75:8199/share/");
    }

    private void postOnReady(String override, String expectedAddress) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> body = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        AtomicReference<String> upgrade = new AtomicReference<>();
        CountDownLatch received = new CountDownLatch(1);
        server.createContext("/discovery/api/heartbeat", exchange -> {
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            upgrade.set(exchange.getRequestHeaders().getFirst("Upgrade"));
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
            received.countDown();
        });
        server.start();
        DiscoveryProperties properties = properties(300);
        properties.setServerUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/discovery");
        properties.setAddress(override);
        DiscoveryReporter reporter = new DiscoveryReporter(properties, mapper,
                new MockEnvironment().withProperty("server.address", "10.13.4.75"), clock::get);
        ServletWebServerApplicationContext context = mock(ServletWebServerApplicationContext.class);
        WebServer webServer = mock(WebServer.class);
        when(context.getWebServer()).thenReturn(webServer);
        when(webServer.getPort()).thenReturn(8199);
        MockServletContext servletContext = new MockServletContext();
        servletContext.setContextPath("/share");
        when(context.getServletContext()).thenReturn(servletContext);
        ApplicationReadyEvent event = mock(ApplicationReadyEvent.class);
        when(event.getApplicationContext()).thenReturn(context);
        try {
            reporter.onReady(event);
            assertTrue(received.await(10, TimeUnit.SECONDS));
            JsonNode payload = mapper.readTree(body.get());
            assertEquals(expectedAddress, payload.get("address").asText());
            assertEquals(mapper.valueToTree(List.of(expectedAddress)), payload.get("addresses"));
            assertEquals(300, payload.get("reportIntervalSeconds").asInt());
            assertEquals("application/json", contentType.get());
            assertNull(upgrade.get());
        } finally {
            reporter.close();
            server.stop(0);
        }
    }

    @Test
    void reportsAddressAdditionRemovalAndChangeButIgnoresReorderingAndDuplicates() {
        DiscoveryReporter reporter = reporter(properties(600));
        List<List<String>> sent = new ArrayList<>();
        String ethernet = "http://10.13.4.75:8081/";
        String wifi = "http://192.168.1.20:8081/";
        DiscoveryReporter.Sender sender = (addresses, interval) -> sent.add(addresses);
        reporter.checkAndReport(() -> List.of(ethernet), sender);
        clock.set(TimeUnit.SECONDS.toNanos(30));
        reporter.checkAndReport(() -> List.of(ethernet, wifi), sender);
        clock.set(TimeUnit.SECONDS.toNanos(60));
        reporter.checkAndReport(() -> List.of(wifi, ethernet, wifi), sender);
        assertEquals(2, sent.size());
        clock.set(TimeUnit.SECONDS.toNanos(90));
        reporter.checkAndReport(() -> List.of(wifi), sender);
        clock.set(TimeUnit.SECONDS.toNanos(120));
        reporter.checkAndReport(() -> List.of("http://192.168.1.21:8081/"), sender);
        assertEquals(List.of(List.of(ethernet), List.of(ethernet, wifi), List.of(wifi),
                List.of("http://192.168.1.21:8081/")), sent);
        reporter.close();
    }

    @Test
    void emptyAddressListDoesNotOverwriteLastSuccessfulReport() {
        DiscoveryReporter reporter = reporter(properties(600));
        List<List<String>> sent = new ArrayList<>();
        DiscoveryReporter.Sender sender = (addresses, interval) -> sent.add(addresses);
        reporter.checkAndReport(() -> List.of("http://10.13.4.75:8081/"), sender);
        clock.set(TimeUnit.SECONDS.toNanos(30));
        reporter.checkAndReport(List::of, sender);
        clock.set(TimeUnit.SECONDS.toNanos(60));
        reporter.checkAndReport(() -> List.of("http://10.13.4.75:8081/"), sender);
        assertEquals(1, sent.size());
        reporter.close();
    }

    @Test
    void selectsBothOrdinaryInterfacesDeduplicatesAndKeepsVirtualAsFallbackOnly() throws Exception {
        InetAddress ethernet = InetAddress.getByName("10.13.4.75");
        InetAddress wifi = InetAddress.getByName("192.168.1.20");
        InetAddress virtual = InetAddress.getByName("172.18.0.1");
        List<LocalServiceAddress.Candidate> candidates = List.of(
                new LocalServiceAddress.Candidate(virtual, 10, 1),
                new LocalServiceAddress.Candidate(wifi, 0, 6),
                new LocalServiceAddress.Candidate(ethernet, 0, 5),
                new LocalServiceAddress.Candidate(ethernet, 0, 7));
        assertEquals(List.of(ethernet, wifi), LocalServiceAddress.selectCandidates(candidates));
        assertEquals(List.of(virtual), LocalServiceAddress.selectCandidates(List.of(candidates.get(0))));
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(DiscoveryProperties.class)
    static class PropertiesConfig {
    }
}
