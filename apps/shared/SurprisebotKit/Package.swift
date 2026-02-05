// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "SurprisebotKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v15),
    ],
    products: [
        .library(name: "SurprisebotKit", targets: ["SurprisebotKit"]),
        .library(name: "SurprisebotChatUI", targets: ["SurprisebotChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
    ],
    targets: [
        .target(
            name: "SurprisebotKit",
            dependencies: [
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "SurprisebotChatUI",
            dependencies: ["SurprisebotKit"],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "SurprisebotKitTests",
            dependencies: ["SurprisebotKit", "SurprisebotChatUI"],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
