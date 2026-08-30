import SwiftUI
import WidgetKit

/// The active mission and how far through it the player is.
struct QuestWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TNRQuestWidget", provider: SnapshotProvider()) { entry in
            QuestWidgetView(entry: entry)
                .containerBackground(TNRStyle.tile.opacity(0.18), for: .widget)
        }
        .configurationDisplayName("Quest")
        .description("Your active mission and its progress.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct QuestWidgetView: View {
    let entry: SnapshotEntry

    var body: some View {
        guard let snapshot = entry.snapshot else {
            return AnyView(SignedOutView())
        }
        guard let quest = snapshot.activeQuest else {
            return AnyView(
                VStack(alignment: .leading, spacing: 6) {
                    Image(systemName: "scroll")
                        .font(.system(size: 18))
                        .foregroundStyle(TNRStyle.ink.opacity(0.7))
                    Text("No active quest")
                        .font(.system(size: 13, weight: .semibold))
                    Text("Pick one up at the mission hall.")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            )
        }
        return AnyView(
            VStack(alignment: .leading, spacing: 8) {
                Label("Active quest", systemImage: "scroll.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text(quest)
                    .font(.system(size: 14, weight: .bold))
                    .lineLimit(3)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                if let progress = snapshot.questProgress {
                    StatBar(
                        label: "Progress",
                        current: Int((progress * 100).rounded()),
                        maximum: 100,
                        fraction: progress,
                        tint: TNRStyle.chakra
                    )
                }
            }
        )
    }
}
