import SwiftUI
import WidgetKit

@main
struct TNRWidgetBundle: WidgetBundle {
    var body: some Widget {
        StatusWidget()
        VillageWidget()
        QuestWidget()
        TNRLiveActivityWidget()
    }
}
