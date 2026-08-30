import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// The three countdowns worth putting on the Lock Screen.
///
/// One `ActivityAttributes` type rather than three: the shapes are identical — a title, a
/// subtitle and an end time — and a single type means one push payload format on the
/// server instead of three that would drift apart.
@available(iOS 16.1, *)
public struct TNRActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public let title: String
        public let subtitle: String?
        /// When the countdown reaches zero.
        public let endsAt: Date
        /// 0-1, for activities that show progress rather than only time remaining.
        public let progress: Double?

        public init(title: String, subtitle: String? = nil, endsAt: Date, progress: Double? = nil) {
            self.title = title
            self.subtitle = subtitle
            self.endsAt = endsAt
            self.progress = progress
        }
    }

    /// Fixed for the life of the activity: which countdown this is, and when it started.
    public let kind: Kind
    public let startedAt: Date

    public init(kind: Kind, startedAt: Date) {
        self.kind = kind
        self.startedAt = startedAt
    }

    public enum Kind: String, Codable, Hashable, Sendable {
        case hospital
        case training
        case war

        public var symbol: String {
            switch self {
            case .hospital: return "cross.case.fill"
            case .training: return "figure.martial.arts"
            case .war: return "flag.fill"
            }
        }

        public var accessibilityLabel: String {
            switch self {
            case .hospital: return "Recovering in hospital"
            case .training: return "Training in progress"
            case .war: return "Village war"
            }
        }
    }
}
#endif
