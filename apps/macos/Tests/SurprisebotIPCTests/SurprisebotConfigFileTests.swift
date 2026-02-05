import Foundation
import Testing
@testable import Surprisebot

@Suite(.serialized)
struct SurprisebotConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager.default.temporaryDirectory
            .appendingPathComponent("surprisebot-config-\(UUID().uuidString)")
            .appendingPathComponent("surprisebot.json")
            .path

        await TestIsolation.withEnvValues(["SURPRISEBOT_CONFIG_PATH": override]) {
            #expect(SurprisebotConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager.default.temporaryDirectory
            .appendingPathComponent("surprisebot-config-\(UUID().uuidString)")
            .appendingPathComponent("surprisebot.json")
            .path

        await TestIsolation.withEnvValues(["SURPRISEBOT_CONFIG_PATH": override]) {
            SurprisebotConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://bridge.ts.net:19999",
                    ],
                ],
            ])
            #expect(SurprisebotConfigFile.remoteGatewayPort() == 19999)
            #expect(SurprisebotConfigFile.remoteGatewayPort(matchingHost: "bridge.ts.net") == 19999)
            #expect(SurprisebotConfigFile.remoteGatewayPort(matchingHost: "bridge") == 19999)
            #expect(SurprisebotConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager.default.temporaryDirectory
            .appendingPathComponent("surprisebot-config-\(UUID().uuidString)")
            .appendingPathComponent("surprisebot.json")
            .path

        await TestIsolation.withEnvValues(["SURPRISEBOT_CONFIG_PATH": override]) {
            SurprisebotConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            SurprisebotConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = SurprisebotConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("surprisebot-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "SURPRISEBOT_CONFIG_PATH": nil,
            "SURPRISEBOT_STATE_DIR": dir,
        ]) {
            #expect(SurprisebotConfigFile.stateDirURL().path == dir)
            #expect(SurprisebotConfigFile.url().path == "\(dir)/surprisebot.json")
        }
    }
}
