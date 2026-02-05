import Darwin
import Foundation
import Testing
@testable import Surprisebot

@Suite struct LogLocatorTests {
    @Test func launchdGatewayLogPathEnsuresTmpDirExists() throws {
        let fm = FileManager.default
        let baseDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let logDir = baseDir.appendingPathComponent("surprisebot-tests-\(UUID().uuidString)")

        setenv("SURPRISEBOT_LOG_DIR", logDir.path, 1)
        defer {
            unsetenv("SURPRISEBOT_LOG_DIR")
            try? fm.removeItem(at: logDir)
        }

        _ = LogLocator.launchdGatewayLogPath

        var isDir: ObjCBool = false
        #expect(fm.fileExists(atPath: logDir.path, isDirectory: &isDir))
        #expect(isDir.boolValue == true)
    }
}
