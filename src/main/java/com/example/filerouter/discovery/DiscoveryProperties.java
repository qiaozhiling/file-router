package com.example.filerouter.discovery;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "discovery")
public class DiscoveryProperties {
    private String serverUrl = "";
    private int reportIntervalSeconds = 300;
    private String address = "";

    public String getServerUrl() {
        return serverUrl;
    }

    public void setServerUrl(String serverUrl) {
        this.serverUrl = serverUrl;
    }

    public int getReportIntervalSeconds() {
        return reportIntervalSeconds;
    }

    public void setReportIntervalSeconds(int reportIntervalSeconds) {
        if (reportIntervalSeconds == 0) {
            throw new IllegalArgumentException("discovery.report-interval-seconds must be positive or negative, not 0");
        }
        this.reportIntervalSeconds = reportIntervalSeconds;
    }

    public String getAddress() {
        return address;
    }

    public void setAddress(String address) {
        this.address = address;
    }
}
