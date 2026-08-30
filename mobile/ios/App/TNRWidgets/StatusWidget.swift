import SwiftUI
import WidgetKit

/// Health, chakra and stamina, plus whatever the player is waiting on. The one people
/// actually keep on the home screen.
struct StatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TNRStatusWidget", provider: SnapshotProvider()) { entry in
            StatusWidgetView(entry: entry)
                .containerBackground(TNRStyle.tile.opacity(0.18), for: .widget)
        }
        .configurationDisplayName("Status")
        .description("Health, chakra and stamina at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct StatusWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        guard let snapshot = entry.snapshot else {
            return AnyView(SignedOutView())
        }
        return AnyView(
            VStack(alignment: .leading, spacing: 7) {
                header(snapshot)
                StatBar(
                    label: "HP",
                    current: snapshot.curHealth,
                    maximum: snapshot.maxHealth,
                    fraction: snapshot.healthFraction,
                    tint: TNRStyle.health,
                    showsNumbers: family != .systemSmall
                )
                StatBar(
                    label: "CP",
                    current: snapshot.curChakra,
                    maximum: snapshot.maxChakra,
                    fraction: snapshot.chakraFraction,
                    tint: TNRStyle.chakra,
                    showsNumbers: family != .systemSmall
                )
                StatBar(
                    label: "SP",
                    current: snapshot.curStamina,
                    maximum: snapshot.maxStamina,
                    fraction: snapshot.staminaFraction,
                    tint: TNRStyle.stamina,
                    showsNumbers: family != .systemSmall
                )
                footer(snapshot)
            }
        )
    }

    private func header(_ snapshot: TNRSnapshot) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(snapshot.username)
                .font(.system(size: 13, weight: .bold))
                .lineLimit(1)
            Spacer(minLength: 2)
            Text("Lv \(snapshot.level)")
                .font(.system(size: 10, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func footer(_ snapshot: TNRSnapshot) -> some View {
        if snapshot.isHospitalised, let until = snapshot.hospitalUntil {
            // A relative style keeps counting down without the widget being refreshed,
            // which matters because WidgetKit budgets refreshes per day.
            Label {
                Text(until, style: .timer).monospacedDigit()
            } icon: {
                Image(systemName: "cross.case.fill")
            }
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(TNRStyle.health)
        } else if snapshot.healthFraction >= 1 {
            Label("Ready", systemImage: "checkmark.circle.fill")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(TNRStyle.stamina)
        } else {
            // No regeneration ETA is shown: the value the app can supply is the last
            // regeneration tick, not a completion time, and a wrong countdown is worse
            // than none. The bars already say where the player is.
            Label("Regenerating", systemImage: "arrow.clockwise")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }
}
