// swift-tools-version: 6.2
// Package manifest for the Surprisebot macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Surprisebot",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "SurprisebotIPC", targets: ["SurprisebotIPC"]),
        .library(name: "SurprisebotDiscovery", targets: ["SurprisebotDiscovery"]),
        .executable(name: "Surprisebot", targets: ["Surprisebot"]),
        .executable(name: "surprisebot-mac-discovery", targets: ["SurprisebotDiscoveryCLI"]),
        .executable(name: "surprisebot-mac-wizard", targets: ["SurprisebotWizardCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(path: "../shared/SurprisebotKit"),
        .package(path: "../../Swabble"),
        .package(path: "../../Peekaboo/Core/PeekabooCore"),
        .package(path: "../../Peekaboo/Core/PeekabooAutomationKit"),
    ],
    targets: [
        .target(
            name: "SurprisebotProtocol",
            dependencies: [],
            path: "Sources/SurprisebotProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "SurprisebotIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "SurprisebotDiscovery",
            dependencies: [
                .product(name: "SurprisebotKit", package: "SurprisebotKit"),
            ],
            path: "Sources/SurprisebotDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Surprisebot",
            dependencies: [
                "SurprisebotIPC",
                "SurprisebotDiscovery",
                "SurprisebotProtocol",
                .product(name: "SurprisebotKit", package: "SurprisebotKit"),
                .product(name: "SurprisebotChatUI", package: "SurprisebotKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "PeekabooCore"),
                .product(name: "PeekabooAutomationKit", package: "PeekabooAutomationKit"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/Surprisebot.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "SurprisebotDiscoveryCLI",
            dependencies: [
                "SurprisebotDiscovery",
            ],
            path: "Sources/SurprisebotDiscoveryCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "SurprisebotWizardCLI",
            dependencies: [
                "SurprisebotProtocol",
            ],
            path: "Sources/SurprisebotWizardCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "SurprisebotIPCTests",
            dependencies: [
                "SurprisebotIPC",
                "Surprisebot",
                "SurprisebotDiscovery",
                "SurprisebotProtocol",
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
