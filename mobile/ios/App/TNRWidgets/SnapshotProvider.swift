import WidgetKit

/// Feeds every widget immediately from the App Group snapshot and refreshes stale data with
/// the device-scoped credential carried in that snapshot.
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
        let local = TNRSnapshotStore.load()
        refreshIfNeeded(local) { snapshot in
            finishTimeline(snapshot, completion: completion)
        }
    }

    private func refreshIfNeeded(
        _ snapshot: TNRSnapshot?,
        completion: @escaping (TNRSnapshot?) -> Void
    ) {
        let now = Date()
        guard let snapshot,
              now.timeIntervalSince(snapshot.updatedAt) > 15 * 60,
              let token = snapshot.widgetToken,
              let rawUrl = snapshot.statusUrl,
              let url = URL(string: rawUrl),
              url.scheme == "https" else {
            completion(snapshot)
            return
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10
        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let data,
                  var remote = try? TNRSnapshotStore.makeDecoder().decode(TNRSnapshot.self, from: data)
            else {
                completion(snapshot)
                return
            }
            remote.widgetToken = token
            remote.statusUrl = rawUrl
            completion(remote)
        }.resume()
    }

    private func finishTimeline(
        _ snapshot: TNRSnapshot?,
        completion: @escaping (Timeline<SnapshotEntry>) -> Void
    ) {
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
        widgetToken: nil,
        statusUrl: nil,
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
