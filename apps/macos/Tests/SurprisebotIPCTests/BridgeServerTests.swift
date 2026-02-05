import Testing
@testable import Surprisebot

@Suite(.serialized)
struct BridgeServerTests {
    @Test func bridgeServerExercisesPaths() async {
        let server = BridgeServer()
        await server.exerciseForTesting()
    }
}
