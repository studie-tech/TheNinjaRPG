import SwiftUI

/// Shared look for every widget, so the three read as one family.
enum TNRStyle {
    /// The launcher tile colour, which is what the icon on the same home screen looks like.
    static let tile = Color(red: 240 / 255, green: 200 / 255, blue: 76 / 255)
    static let ink = Color(red: 35 / 255, green: 24 / 255, blue: 10 / 255)

    static let health = Color(red: 0.85, green: 0.25, blue: 0.25)
    static let chakra = Color(red: 0.25, green: 0.45, blue: 0.85)
    static let stamina = Color(red: 0.25, green: 0.65, blue: 0.35)
}

extension View {
    /// `containerBackground` is iOS 17, and this extension deploys to 16.1. On 17 and
    /// later the system needs the container form to lay the widget out correctly; before
    /// that a plain background is the equivalent.
    @ViewBuilder
    func tnrWidgetBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(color, for: .widget)
        } else {
            background(color)
        }
    }
}

/// A labelled bar. Reads at a glance as a colour and a length, with the numbers there for
/// anyone who wants them.
struct StatBar: View {
    let label: String
    let current: Int
    let maximum: Int
    let fraction: Double
    let tint: Color
    var showsNumbers = true

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(label)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
                if showsNumbers {
                    Spacer(minLength: 2)
                    Text("\(current)/\(maximum)")
                        .font(.system(size: 9, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(tint.opacity(0.2))
                    Capsule()
                        .fill(tint)
                        .frame(width: max(2, geometry.size.width * fraction))
                }
            }
            .frame(height: 5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label) \(current) of \(maximum)")
    }
}

/// Shown before the player has ever opened the app, or after they sign out.
struct SignedOutView: View {
    var body: some View {
        VStack(spacing: 6) {
            Text("🥷").font(.system(size: 28))
            Text("Open TheNinja-RPG to start")
                .font(.system(size: 11, weight: .medium))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(8)
    }
}
