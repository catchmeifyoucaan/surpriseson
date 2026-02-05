import Foundation

public enum SurprisebotChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(SurprisebotChatEventPayload)
    case agent(SurprisebotAgentEventPayload)
    case seqGap
}

public protocol SurprisebotChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> SurprisebotChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [SurprisebotChatAttachmentPayload]) async throws -> SurprisebotChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> SurprisebotChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<SurprisebotChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension SurprisebotChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "SurprisebotChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> SurprisebotChatSessionsListResponse {
        throw NSError(
            domain: "SurprisebotChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
