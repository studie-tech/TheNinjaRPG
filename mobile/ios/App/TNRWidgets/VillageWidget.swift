import SwiftUI
import WidgetKit

/// Village, rank and unread count — the "anything happening?" glance.
struct VillageWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TNRVillageWidget", provider: SnapshotProvider()) { entry in
            VillageWidgetView(entry: entry)
                .tnrWidgetBackground(TNRStyle.tile.opacity(0.18))
        }
        .configurationDisplayName("Village")
        .description("Your village, rank and unread notifications.")
        .supportedFamilies([.systemSmall])
    }
}

struct VillageWidgetView: View {
    let entry: SnapshotEntry

    var body: some View {
        guard let snapshot = entry.snapshot else {
            return AnyView(SignedOutView())
        }
        return AnyView(
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: "building.columns.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(TNRStyle.ink.opacity(0.7))
                Text(snapshot.village ?? "No village")
                    .font(.system(size: 15, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let rank = snapshot.rank {
                    Text(rank.capitalized)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if snapshot.unreadNotifications > 0 {
                    Label {
                        Text("\(snapshot.unreadNotifications) unread").monospacedDigit()
                    } icon: {
                        Image(systemName: "bell.badge.fill")
                    }
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(TNRStyle.health)
                }
            }
        )
    }
}
