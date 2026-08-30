import AVFoundation
import Capacitor
import Foundation
import MediaPlayer

/// Background audio and the Lock Screen transport.
///
/// The WebView plays the soundtrack; this only decides whether iOS lets it keep going once
/// the screen locks, and puts something usable on the Lock Screen when it does. Playback
/// itself stays in `useAudio`, which already handles the first-play-needs-a-gesture rule.
@objc(TNRAudioSessionPlugin)
public class TNRAudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TNRAudioSessionPlugin"
    public let jsName = "TNRAudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deactivate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRemoteCommandsEnabled", returnType: CAPPluginReturnPromise),
    ]

    private var remoteCommandsEnabled = false
    private var artworkTask: URLSessionDataTask?

    @objc func activate(_ call: CAPPluginCall) {
        do {
            let session = AVAudioSession.sharedInstance()
            // .playback is what keeps audio alive behind the lock screen. `.mixWithOthers`
            // is deliberately absent: a game soundtrack that plays over the player's own
            // music is worse than one that pauses it, and the player can just mute ours.
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            call.resolve()
        } catch {
            call.reject("Could not activate the audio session", nil, error)
        }
    }

    @objc func deactivate(_ call: CAPPluginCall) {
        do {
            // Telling other apps we are done is what un-ducks their audio; without the
            // notification they stay quiet until something else claims the session.
            try AVAudioSession.sharedInstance().setActive(
                false,
                options: [.notifyOthersOnDeactivation]
            )
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            call.resolve()
        } catch {
            call.reject("Could not release the audio session", nil, error)
        }
    }

    @objc func setNowPlaying(_ call: CAPPluginCall) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: call.getString("title") ?? "TheNinja-RPG",
            MPNowPlayingInfoPropertyIsLiveStream: true,
        ]
        if let artist = call.getString("artist") {
            info[MPMediaItemPropertyArtist] = artist
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        if let artworkUrl = call.getString("artworkUrl"), let url = URL(string: artworkUrl) {
            loadArtwork(from: url)
        }
        call.resolve()
    }

    @objc func setRemoteCommandsEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = enabled
        center.pauseCommand.isEnabled = enabled
        center.togglePlayPauseCommand.isEnabled = enabled
        // Nothing here is seekable, and leaving these on puts dead controls on the Lock
        // Screen.
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false
        center.changePlaybackPositionCommand.isEnabled = false

        if enabled && !remoteCommandsEnabled {
            center.playCommand.addTarget { [weak self] _ in
                self?.emit("play")
                return .success
            }
            center.pauseCommand.addTarget { [weak self] _ in
                self?.emit("pause")
                return .success
            }
            center.togglePlayPauseCommand.addTarget { [weak self] _ in
                self?.emit("toggle")
                return .success
            }
        } else if !enabled && remoteCommandsEnabled {
            center.playCommand.removeTarget(nil)
            center.pauseCommand.removeTarget(nil)
            center.togglePlayPauseCommand.removeTarget(nil)
        }
        remoteCommandsEnabled = enabled
        call.resolve()
    }

    private func emit(_ command: String) {
        notifyListeners("remoteCommand", data: ["command": command])
    }

    private func loadArtwork(from url: URL) {
        artworkTask?.cancel()
        artworkTask = URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                // Re-read rather than capturing: the track may have changed while this
                // download was in flight, and overwriting the whole dictionary would
                // wipe the newer title.
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
        artworkTask?.resume()
    }
}
