import Foundation

/// The player state the app writes into the shared container for the widgets to render.
///
/// Compiled into both the app and the widget extension so the two cannot disagree about
/// the shape. It mirrors `WidgetSnapshot` in `app/src/libs/native/widgetBridge.ts`; the
/// JSON is produced there and decoded here, so a field added on one side must be added on
/// the other.
public struct TNRSnapshot: Codable, Equatable, Sendable {
    public let updatedAt: Date
    public var widgetToken: String?
    public var statusUrl: String?
    public let username: String
    public let avatar: String?
    public let village: String?
    public let rank: String?
    public let level: Int
    public let curHealth: Int
    public let maxHealth: Int
    public let curChakra: Int
    public let maxChakra: Int
    public let curStamina: Int
    public let maxStamina: Int
    public var hospitalUntil: Date?
    public let unreadNotifications: Int
    public var activeQuest: String?
    public var questProgress: Double?

    public var healthFraction: Double { Self.fraction(curHealth, maxHealth) }
    public var chakraFraction: Double { Self.fraction(curChakra, maxChakra) }
    public var staminaFraction: Double { Self.fraction(curStamina, maxStamina) }

    public var isHospitalised: Bool {
        guard let hospitalUntil else { return false }
        return hospitalUntil > Date()
    }

    private static func fraction(_ current: Int, _ maximum: Int) -> Double {
        guard maximum > 0 else { return 0 }
        return min(1, max(0, Double(current) / Double(maximum)))
    }
}

/// Reads and writes the snapshot in the App Group container.
///
/// `UserDefaults` rather than a file: the payload is a couple of hundred bytes, and the
/// suite handles the cross-process coordination that a file would need locking for.
public enum TNRSnapshotStore {
    public static let appGroup =
        Bundle.main.object(forInfoDictionaryKey: "TNRAppGroup") as? String
        ?? "group.com.theninjarpg.app"
    private static let key = "tnr.widget.snapshot"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    /// ISO-8601 with fractional seconds, which is what `Date.toISOString()` produces.
    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = formatter.date(from: raw) ?? fallback.date(from: raw) {
                return date
            }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Bad date: \(raw)")
            )
        }
        return decoder
    }

    public static func save(json: String) {
        defaults?.set(json, forKey: key)
    }

    /// Persist a snapshot produced by native code rather than the web bridge.
    public static func save(snapshot: TNRSnapshot) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(snapshot),
              let json = String(data: data, encoding: .utf8) else { return }
        save(json: json)
    }

    public static func clear() {
        defaults?.removeObject(forKey: key)
    }

    public static func load() -> TNRSnapshot? {
        guard let json = defaults?.string(forKey: key),
              let data = json.data(using: .utf8) else { return nil }
        return try? makeDecoder().decode(TNRSnapshot.self, from: data)
    }
}
