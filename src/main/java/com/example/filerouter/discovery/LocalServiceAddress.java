package com.example.filerouter.discovery;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;

final class LocalServiceAddress {
    private LocalServiceAddress() {
    }

    static List<String> resolve(int port, String contextPath, String bindAddress, boolean ssl) throws Exception {
        List<InetAddress> addresses;
        if (!bindAddress.isBlank() && !InetAddress.getByName(bindAddress).isAnyLocalAddress()) {
            addresses = List.of(InetAddress.getByName(bindAddress));
        } else {
            addresses = findLanAddresses();
        }
        List<String> urls = new ArrayList<>();
        for (InetAddress address : addresses) {
            if (!address.isLoopbackAddress() && !address.isAnyLocalAddress()) {
                urls.add(new URI(ssl ? "https" : "http", null, address.getHostAddress(), port,
                        contextPath.replaceAll("/+$", "") + "/", null, null).toASCIIString());
            }
        }
        if (urls.isEmpty()) {
            throw new IllegalStateException("No reachable LAN address found; set discovery.address explicitly");
        }
        return urls;
    }

    private static List<InetAddress> findLanAddresses() throws SocketException {
        List<Candidate> candidates = new ArrayList<>();
        java.util.Enumeration<NetworkInterface> networks = NetworkInterface.getNetworkInterfaces();
        if (networks == null) {
            return List.of();
        }
        for (NetworkInterface network : Collections.list(networks)) {
            if (!network.isUp() || network.isLoopback() || network.isPointToPoint()) {
                continue;
            }
            String description = (network.getName() + " " + network.getDisplayName()).toLowerCase(Locale.ROOT);
            boolean virtual = network.isVirtual() || description.matches(
                    ".*(virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|tailscale|zerotier|vpn|loopback).*"
            );
            for (InetAddress address : Collections.list(network.getInetAddresses())) {
                if (address instanceof Inet4Address && !address.isLoopbackAddress()
                        && !address.isLinkLocalAddress() && !address.isAnyLocalAddress()
                        && !address.isMulticastAddress()) {
                    int priority = (virtual ? 10 : 0) + (address.isSiteLocalAddress() ? 0 : 1);
                    candidates.add(new Candidate(address, priority, network.getIndex()));
                }
            }
        }
        return selectCandidates(candidates);
    }

    static List<InetAddress> selectCandidates(List<Candidate> candidates) {
        boolean hasOrdinaryInterface = candidates.stream().anyMatch(candidate -> candidate.priority < 10);
        return candidates.stream()
                .filter(candidate -> !hasOrdinaryInterface || candidate.priority < 10)
                .sorted(Comparator.comparingInt((Candidate candidate) -> candidate.priority)
                .thenComparingInt(candidate -> candidate.interfaceIndex)
                .thenComparing(candidate -> candidate.address.getHostAddress()))
                .map(candidate -> candidate.address).distinct().collect(Collectors.toList());
    }

    static URI httpUri(String value) {
        try {
            URI uri = new URI(value.trim());
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getRawUserInfo() != null
                    || uri.getPort() == 0 || uri.getPort() > 65535) {
                throw new IllegalArgumentException("Expected an HTTP(S) URL with a hostname and no credentials");
            }
            return uri;
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("Invalid HTTP(S) URL", exception);
        }
    }

    static final class Candidate {
        private final InetAddress address;
        private final int priority;
        private final int interfaceIndex;

        Candidate(InetAddress address, int priority, int interfaceIndex) {
            this.address = address;
            this.priority = priority;
            this.interfaceIndex = interfaceIndex;
        }
    }
}
