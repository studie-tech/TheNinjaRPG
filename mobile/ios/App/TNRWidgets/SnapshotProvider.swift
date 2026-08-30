import WidgetKit

/// Feeds every widget from the App Group snapshot the app writes on each foreground.
///
/// No network: a widget that has to fetch shows a spinner or stale placeholder for the
/// first second of every refresh, and would need its own credential. Reading a local
/// snapshot renders instantly and costs nothing.
struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: TNRSnapshot?
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: .preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        // The gallery preview must never show a real player's stats.
        let snapshot = context.isPreview ? TNRSnapshot.preview : TNRSnapshotStore.load()
        completion(SnapshotEntry(date: Date(), snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let snapshot = TNRSnapshotStore.load()
        let now = Date()

        // Refresh when something is actually due to change — the player leaving hospital
        // — and otherwise fall back to a slow poll. WidgetKit budgets refreshes per app
        // per day, so asking every minute gets us throttled and the widget stops updating
        // at all.
        let nextChange = [snapshot?.hospitalUntil]
            .compactMap { $0 }
            .filter { $0 > now }
            .min()
        let fallback = now.addingTimeInterval(30 * 60)
        let refreshAt = min(nextChange ?? fallback, fallback)

        completion(
            Timeline(entries: [SnapshotEntry(date: now, snapshot: snapshot)], policy: .after(refreshAt))
        )
    }
}

extension TNRSnapshot {
    /// Fixed values for the widget gallery and for previews.
    static let preview = TNRSnapshot(
        updatedAt: Date(),
        username: "Shinobi",
        avatar: nil,
        village: "Tsukimori",
        rank: "CHUNIN",
        level: 42,
        curHealth: 780,
        maxHealth: 1200,
        curChakra: 410,
        maxChakra: 900,
        curStamina: 640,
        maxStamina: 900,
        hospitalUntil: nil,
        unreadNotifications: 3,
        activeQuest: "Escort the Merchant",
        questProgress: 0.6
    )
}
