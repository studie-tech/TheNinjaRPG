import Foundation
import Darwin

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
    private static let processLock = NSLock()

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    /// Serialize all reads and writes across the app and widget extension. The process
    /// lock covers same-process callers; flock covers the two executable processes sharing
    /// the App Group. Every store operation participates, making compare-and-save atomic.
    private static func withLock<T>(_ operation: () -> T) -> T {
        processLock.lock()
        defer { processLock.unlock() }

        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroup
        ) else { return operation() }
        let descriptor = open(
            container.appendingPathComponent(".tnr-snapshot.lock").path,
            O_CREAT | O_RDWR,
            S_IRUSR | S_IWUSR
        )
        guard descriptor >= 0 else { return operation() }
        defer {
            flock(descriptor, LOCK_UN)
            close(descriptor)
        }
        guard flock(descriptor, LOCK_EX) == 0 else { return operation() }
        return operation()
    }

    private static func loadUnlocked() -> TNRSnapshot? {
        guard let defaults else { return nil }
        defaults.synchronize()
        guard let json = defaults.string(forKey: key),
              let data = json.data(using: .utf8) else { return nil }
        return try? makeDecoder().decode(TNRSnapshot.self, from: data)
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
        withLock {
            guard let defaults else { return }
            defaults.set(json, forKey: key)
            defaults.synchronize()
        }
    }

    /// Persist a snapshot produced by native code rather than the web bridge.
    public static func save(snapshot: TNRSnapshot) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(snapshot),
              let json = String(data: data, encoding: .utf8) else { return }
        save(json: json)
    }

    /// Save a network refresh only while the account snapshot it started from is current.
    ///
    /// The app can sign out or bind another player while the widget request is in flight.
    /// In that case persisting the response would restore the previous player's token and
    /// stats after the app deliberately replaced or cleared them.
    @discardableResult
    public static func save(snapshot: TNRSnapshot, ifUnchangedFrom expected: TNRSnapshot) -> Bool {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(snapshot),
              let json = String(data: data, encoding: .utf8) else { return false }
        return withLock {
            guard let defaults else { return false }
            guard loadUnlocked() == expected else { return false }
            defaults.set(json, forKey: key)
            defaults.synchronize()
            return true
        }
    }

    public static func clear() {
        withLock {
            guard let defaults else { return }
            defaults.removeObject(forKey: key)
            defaults.synchronize()
        }
    }

    public static func load() -> TNRSnapshot? {
        withLock { loadUnlocked() }
    }
}
