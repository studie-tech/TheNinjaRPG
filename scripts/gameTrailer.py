"""
Game Trailer Generator for TheNinja-RPG
Uses MoviePy to create a trailer with effects, transitions, and text overlays.
Its length is derived from the TIMELINE segment durations plus the intro and outro.
"""

from moviepy import (
    VideoFileClip,
    AudioFileClip,
    TextClip,
    ImageClip,
    CompositeVideoClip,
    CompositeAudioClip,
    concatenate_videoclips,
    concatenate_audioclips,
    ColorClip,
    vfx,
    afx,
)
import os
import argparse

# Configuration
CLIPS_DIR = "clips"  # Directory containing the recorded video clips
VIDEO_SIZE = (1920, 1080)  # Target resolution
FPS = 30
TEXT_DURATION = 3  # Seconds of each segment spent on its text screen

# Background music (located in clips directory)
BACKGROUND_MUSIC = os.path.join(CLIPS_DIR, "xevan_welcome_to_seichi_compressed.m4a")

WALLPAPER_ANIMATED = os.path.join(CLIPS_DIR, "wallpaper-bright-animated.mp4")

LOGO_FILE = os.path.join(CLIPS_DIR, "logo_final.webp")

FONT_FILE = os.path.join(CLIPS_DIR, "aAsianNinja.ttf")

OUTRO_NARRATION = os.path.join(CLIPS_DIR, "play-for-free.mp3")

# Timeline segments with text overlays
# Each segment has a duration in seconds
# Each segment can optionally specify a "wallpaper" path for custom animated background
# If not specified, uses WALLPAPER_ANIMATED as default
# Each segment can optionally specify a "narration" path for voice-over audio
# Each segment can optionally specify "scale_duration" (default True) to scale clips to fit duration or cut them off
# Each segment can optionally specify "include_audio" (default False) to include audio from clips
# Each segment should have "mobile_text" for mobile version line breaks (defaults to "text" if not provided)
# Each segment can optionally specify "mobile_clips" for mobile-specific video clips (uses "clips" if not provided)
# Example: {"duration": 5, "text": "...", "mobile_text": "...", "clips": [...], "mobile_clips": [...], "wallpaper": "clips/custom.mp4", "narration": "clips/voiceover.mp3", "scale_duration": True, "include_audio": False}
TIMELINE = [
    {
        "duration": 5,
        "text": "BROWSER GAMES ARE DEAD?\nWATCH THIS",
        "mobile_text": "BROWSER GAMES ARE DEAD? WATCH THIS",
        "clips": ["intro_hook_1.mp4"],
        "narration": os.path.join(CLIPS_DIR, "browser-based-games-are-dead.mp3"),
        "scale_duration": False,
        "include_audio": False,
    },
    {
        "duration": 5,
        "text": "FIGHT STRATEGIC BATTLES\nUSING JUTSUS AND WEAPONS",
        "mobile_text": "FIGHT STRATEGIC BATTLES USING JUTSUS\n AND WEAPONS",
        "clips": ["combat.mov"],
        "mobile_clips": ["combat-mobile.mov"],
        "wallpaper": os.path.join(CLIPS_DIR, "wallpaper-glacier-animated.mp4"),
        "narration": os.path.join(CLIPS_DIR, "fight-strategic-battles.mp3"),
        "scale_duration": True,
        "include_audio": False,
    },
    {
        "duration": 5,
        "text": "EXPLORE THE WORLD OF SEICHI\nIN A FREE MMORPG",
        "mobile_text": "EXPLORE THE WORLD OF SEICHI IN A FREE \nMMORPG",
        "clips": ["global.mp4", "sector.mp4"],
        "mobile_clips": ["global-sector-mobile.mov"],
        "wallpaper": os.path.join(CLIPS_DIR, "wallpaper-tsukimori-animated.mp4"),
        "narration": os.path.join(CLIPS_DIR, "explore-the-world.mp3"),
        "scale_duration": True,
        "include_audio": False,
    },
    {
        "duration": 7,
        "text": "TRAIN YOUR STATS\nAND MASTER YOUR JUTSUS",
        "mobile_text": "TRAIN YOUR STATS AND MASTER YOUR JUTSUS",
        "clips": ["training.mp4", "profile.mov"],
        "mobile_clips": ["training-mobile.mov", "profile-mobile.mov"],
        "wallpaper": os.path.join(CLIPS_DIR, "wallpaper-shroud-animated.mp4"),
        "narration": os.path.join(CLIPS_DIR, "train-your-stats.mp3"),
        "scale_duration": True,
        "include_audio": False,
    },

    {
        "duration": 4,
        "text": "CLAIM YOUR BLOODLINE\nAND UNLOCK UNIQUE ABILITIES",
        "mobile_text": "CLAIM YOUR BLOODLINE AND UNLOCK UNIQUE \nABILITIES",
        "clips": ["bloodline.mov"],
        "mobile_clips": ["bloodline-mobile.mov"],
        "wallpaper": os.path.join(CLIPS_DIR, "wallpaper-current-animated.mp4"),
        "narration": os.path.join(CLIPS_DIR, "claim-your-bloodline.mp3"),
        "scale_duration": True,
        "include_audio": False,
    },
    {
        "duration": 5,
        "text": "800+ UNIQUE JUTSU AND \n50+ BLOODLINES",
        "mobile_text": "800+ UNIQUE JUTSU AND 50+ BLOODLINES",
        "clips": ["jutsus.mov"],
        "mobile_clips": ["jutsus-mobile.mov"],
        "wallpaper": os.path.join(CLIPS_DIR, "wallpaper-shine-animated.mp4"),
        "narration": os.path.join(CLIPS_DIR, "more-than-content.mp3"),
        "scale_duration": True,
        "include_audio": False,
    },
    {
        "duration":7,
        "text": "CUSTOMIZE YOUR NINJA WITH\nWEAPONS, ARMOR, AND SPECIAL ITEMS",
        "mobile_text": "CUSTOMIZE YOUR NINJA WITH WEAPONS, ARMOR, AND SPECIAL ITEMS",
        "clips": ["itemshop.mp4", "equipment.mov"],
        "mobile_clips": ["itemshop-mobile.mov", "equipment-mobile.mov"],
        "narration": os.path.join(CLIPS_DIR, "customize-your-ninja.mp3"),
        "scale_duration": True,
        "include_audio": False,
    },
    
    {
        "duration":7,
        "text": "AND GO ON EPIC QUESTS \nTO SUPPORT YOUR VILLAGE",
        "mobile_text": "AND GO ON EPIC QUESTS TO SUPPORT YOUR\n VILLAGE",
        "clips": ["quest.mp4"],
        "mobile_clips": ["quest-mobile.mov"],
        "narration": os.path.join(CLIPS_DIR, "and-go-on-quests.mp3"),
        "scale_duration": True,
        "include_audio": False,
    },
]


def resolve_font():
    """Return the custom font, falling back to Impact when it is missing"""
    if os.path.exists(FONT_FILE):
        return FONT_FILE
    print(f"⚠ Custom font not found: {FONT_FILE}, using Impact fallback")
    return "Impact"


def load_narration(path, duration):
    """Load narration trimmed to duration, with short fades and a slight volume boost"""
    narration_audio = AudioFileClip(path)
    if narration_audio.duration > duration:
        narration_audio = narration_audio.subclipped(0, duration)
    return narration_audio.with_effects([
        afx.AudioFadeIn(0.3),
        afx.AudioFadeOut(0.3),
        afx.MultiplyVolume(1.2)
    ])


def load_animated_wallpaper(wallpaper_path, duration, size, mobile_mode=False):
    """Load and prepare animated wallpaper background
    
    Args:
        wallpaper_path: Path to the wallpaper video file
        duration: Target duration in seconds
        size: Target size (width, height)
        mobile_mode: If True, maintain aspect ratio and crop to fill; if False, resize to fit
    """
    if os.path.exists(wallpaper_path):
        try:
            bg = VideoFileClip(wallpaper_path)
            # Loop the video if it's shorter than the duration
            if bg.duration < duration:
                loops_needed = int(duration / bg.duration) + 1
                bg = concatenate_videoclips([bg] * loops_needed)
            # Trim to exact duration
            bg = bg.subclipped(0, duration)
            
            if mobile_mode:
                # Mobile mode: maintain aspect ratio and fill screen (cover behavior)
                target_aspect = size[0] / size[1]
                bg_aspect = bg.w / bg.h
                
                if bg_aspect > target_aspect:
                    # Wallpaper is wider - scale to height and crop width
                    bg = bg.resized(height=size[1])
                    # Center crop the width
                    x_center = bg.w / 2
                    x1 = int(x_center - size[0] / 2)
                    bg = bg.cropped(x1=x1, width=size[0])
                else:
                    # Wallpaper is taller - scale to width and crop height
                    bg = bg.resized(width=size[0])
                    # Center crop the height
                    y_center = bg.h / 2
                    y1 = int(y_center - size[1] / 2)
                    bg = bg.cropped(y1=y1, height=size[1])
            else:
                # Desktop mode: resize to fit (may distort aspect ratio)
                bg = bg.resized(size)
            
            # Always mute wallpaper audio
            bg = bg.without_audio()
            return bg
        except Exception as e:
            print(f"⚠ Could not load animated wallpaper {wallpaper_path}: {e}, using black background")
            return ColorClip(size=size, color=(0, 0, 0)).with_duration(duration)
    else:
        print(f"⚠ Animated wallpaper not found: {wallpaper_path}, using black background")
        return ColorClip(size=size, color=(0, 0, 0)).with_duration(duration)


def create_text_screen(text, duration, size=VIDEO_SIZE, fontsize=None, color="white", wallpaper=None, mobile_mode=False):
    """Create a full-screen text clip with centered text on animated wallpaper background"""
    # Auto-scale font size based on resolution if not specified
    if fontsize is None:
        base_fontsize = int(size[1] / 9)  # Large, bold text
        # Half the font size for mobile mode
        fontsize = int(base_fontsize / 2) if mobile_mode else base_fontsize
    
    # Auto-scale stroke width based on resolution
    stroke_width = max(1, int(size[1] / 180))  # Scales with height, min 1px
    
    # Timing for fade effects
    wallpaper_fade_duration = 0.4
    text_delay = 0.5  # Delay before text starts fading in
    text_fade_duration = 0.3
    
    # Use provided wallpaper or default
    wallpaper_path = wallpaper if wallpaper is not None else WALLPAPER_ANIMATED
    
    # Create animated wallpaper background with fade-in
    bg = load_animated_wallpaper(wallpaper_path, duration, size, mobile_mode=mobile_mode)
    bg = bg.with_effects([vfx.FadeIn(wallpaper_fade_duration)])
    
    font = resolve_font()
    
    # Create text clip with delayed fade-in and black stroke
    # Use standard text width since we have manual line breaks for mobile
    text_width_percent = 0.9
    txt = (
        TextClip(
            text=text,
            font=font,
            font_size=fontsize,
            color=color,
            size=(int(size[0] * text_width_percent), None),
            method="caption",
            text_align="center",
            stroke_color="black",
            stroke_width=stroke_width,
        )
        .with_duration(duration - text_delay)
        .with_position("center")
        .with_start(text_delay)
        .with_effects([vfx.FadeIn(text_fade_duration)])
    )
    
    # Start with background and text
    elements = [bg, txt]
    
    # Add logo at the top for mobile mode
    if mobile_mode and os.path.exists(LOGO_FILE):
        try:
            logo = ImageClip(LOGO_FILE)
            # Scale logo to fit nicely at the top (smaller than outro)
            max_width = int(size[0] * 0.7)
            max_height = int(size[1] * 0.15)
            
            # Calculate scaling
            scale = min(max_width / logo.w, max_height / logo.h)
            logo = logo.resized(scale)
            
            # Position logo at the top center
            logo = (
                logo
                .with_duration(duration - text_delay)
                .with_position(("center", int(size[1] * 0.12)))
                .with_start(text_delay)
                .with_effects([vfx.FadeIn(text_fade_duration)])
            )
            elements.append(logo)
            
        except Exception as e:
            print(f"⚠ Could not load logo for text screen: {e}")
    
    # Composite: background -> text -> logo (if mobile)
    composite = CompositeVideoClip(elements, size=size)
    
    return composite


def load_and_prepare_clip(clip_name, target_duration, size=VIDEO_SIZE, scale_duration=True, include_audio=False):
    """Load a video clip, resize, and adjust duration based on parameters
    
    Args:
        clip_name: Name of the video clip file
        target_duration: Target duration in seconds
        size: Target video size (width, height)
        scale_duration: If True, scale clip to fit duration; if False, cut off after duration
        include_audio: If True, keep clip audio; if False, mute it
    """
    clip_path = os.path.join(CLIPS_DIR, clip_name)
    
    if not os.path.exists(clip_path):
        print(f"Warning: {clip_path} not found, creating placeholder")
        return ColorClip(size=size, color=(20, 20, 40), duration=target_duration)
    
    clip = VideoFileClip(clip_path)
    
    # Handle audio based on include_audio parameter
    if not include_audio:
        clip = clip.without_audio()
    
    # Handle duration based on scale_duration parameter
    if scale_duration:
        # Calculate speed factor to fit the entire clip within target_duration
        # If clip is longer than target, speed it up. If shorter, slow it down.
        calculated_speed_factor = clip.duration / target_duration
        
        # Apply the calculated speed factor
        if calculated_speed_factor != 1.0:
            clip = clip.with_effects([vfx.MultiplySpeed(calculated_speed_factor)])
            print(f"  → Scaling {clip_name} speed by {calculated_speed_factor:.2f}x to fit {target_duration:.1f}s (original: {clip.duration:.1f}s)")
        
        # Set clip to exact target duration (should already match after speed adjustment)
        clip = clip.with_duration(target_duration)
    else:
        # Cut off the clip after target_duration
        if clip.duration > target_duration:
            clip = clip.subclipped(0, target_duration)
            print(f"  → Cutting {clip_name} at {target_duration:.1f}s (original: {clip.duration:.1f}s)")
        else:
            # If clip is shorter than target, set to target duration (will pad with black)
            clip = clip.with_duration(target_duration)
            print(f"  → Extending {clip_name} to {target_duration:.1f}s (original: {clip.duration:.1f}s)")
    
    # Calculate aspect ratios
    target_aspect = size[0] / size[1]  # e.g., 16:9 = 1.778
    clip_aspect = clip.w / clip.h
    
    # If clip is square-ish (aspect ratio < target), scale to width instead of height
    if clip_aspect < target_aspect:
        # Scale to full width
        clip = clip.resized(width=size[0])
        
        # Crop from bottom if taller than target
        if clip.h > size[1]:
            # Crop from top (y1=0) to target height, removing excess from bottom
            clip = clip.cropped(y1=0, height=size[1])
        
        # Add padding at bottom if shorter than target
        elif clip.h < size[1]:
            bg = ColorClip(size=size, color=(0, 0, 0), duration=target_duration)
            clip = CompositeVideoClip([bg, clip.with_position(("center", 0))], size=size)
    else:
        # Widescreen clip: scale to height and center-crop
        clip = clip.resized(height=size[1])
        
        # Center crop if wider than target
        if clip.w > size[0]:
            x_center = clip.w / 2
            x1 = int(x_center - size[0] / 2)
            clip = clip.cropped(x1=x1, width=size[0])
        
        # Add padding if narrower than target
        if clip.w < size[0]:
            bg = ColorClip(size=size, color=(0, 0, 0), duration=target_duration)
            clip = CompositeVideoClip([bg, clip.with_position("center")], size=size)
    
    return clip


def create_segment(timeline_item, video_size=VIDEO_SIZE, mobile_mode=False):
    """Create a segment with text screen followed by video clips"""
    total_duration = timeline_item["duration"]
    
    # Use mobile_clips if in mobile mode and they exist, otherwise use regular clips
    if mobile_mode and "mobile_clips" in timeline_item:
        clip_names = timeline_item["mobile_clips"]
    else:
        clip_names = timeline_item["clips"]
    
    # Allocate time: text screen first, remaining for clips
    text_duration = TEXT_DURATION
    clips_duration = total_duration - text_duration
    
    # Create text screen (fade-in is handled internally)
    # Use wallpaper from timeline item if provided
    wallpaper = timeline_item.get("wallpaper")
    # Use mobile_text for mobile mode, fallback to text if not provided
    text = timeline_item.get("mobile_text", timeline_item["text"]) if mobile_mode else timeline_item["text"]
    text_screen = create_text_screen(text, text_duration, size=video_size, wallpaper=wallpaper, mobile_mode=mobile_mode)
    text_screen = text_screen.with_effects([vfx.FadeOut(0.3)])
    
    # Calculate duration per clip
    duration_per_clip = clips_duration / len(clip_names)
    
    # Get clip options from timeline item (with defaults)
    scale_duration = timeline_item.get("scale_duration", True)
    include_audio = timeline_item.get("include_audio", False)
    
    # Load and prepare video clips
    video_clips = []
    for clip_name in clip_names:
        # Speed is adjusted or clipped based on scale_duration parameter
        clip = load_and_prepare_clip(
            clip_name, 
            duration_per_clip, 
            size=video_size, 
            scale_duration=scale_duration, 
            include_audio=include_audio
        )
        clip = clip.with_effects([vfx.FadeIn(0.3), vfx.FadeOut(0.3)])
        video_clips.append(clip)
    
    # Concatenate video clips
    if len(video_clips) > 1:
        video_section = concatenate_videoclips(video_clips, method="compose")
    else:
        video_section = video_clips[0]
    
    # Concatenate text screen and video clips
    final_segment = concatenate_videoclips([text_screen, video_section], method="compose")
    
    # Add narration audio if provided
    narration_path = timeline_item.get("narration")
    if narration_path and os.path.exists(narration_path):
        try:
            narration_audio = load_narration(narration_path, total_duration)
            
            # Mix narration with clip audio if clips have audio
            if final_segment.audio is not None:
                # Mix narration with existing clip audio
                mixed_audio = CompositeAudioClip([final_segment.audio, narration_audio])
                final_segment = final_segment.with_audio(mixed_audio)
                print(f"  → Mixed narration with clip audio: {os.path.basename(narration_path)}")
            else:
                # No clip audio, just attach narration
                final_segment = final_segment.with_audio(narration_audio)
                print(f"  → Added narration: {os.path.basename(narration_path)}")
        except Exception as e:
            print(f"  ⚠ Could not load narration {narration_path}: {e}")
    elif narration_path:
        print(f"  ⚠ Narration not found: {narration_path}")
    elif final_segment.audio is not None:
        print("  → Using clip audio only (no narration)")
    
    return final_segment


def load_background_music(duration):
    """Load and prepare background music for the trailer"""
    if not os.path.exists(BACKGROUND_MUSIC):
        print(f"⚠ Background music not found: {BACKGROUND_MUSIC}")
        return None
    
    try:
        audio = AudioFileClip(BACKGROUND_MUSIC)
        
        # Loop the audio if it's shorter than the trailer duration
        if audio.duration < duration:
            # Calculate how many loops we need
            loops_needed = int(duration / audio.duration) + 1
            audio = concatenate_audioclips([audio] * loops_needed)
        
        # Trim to exact duration
        audio = audio.subclipped(0, duration)
        
        # Add fade in and fade out effects, and reduce volume
        audio = audio.with_effects([
            afx.AudioFadeIn(3.0),  # Longer fade-in for smoother start
            afx.AudioFadeOut(2.0),
            afx.MultiplyVolume(0.49)  # Background music level
        ])
        
        print(f"✓ Background music loaded: {BACKGROUND_MUSIC}")
        return audio
    except Exception as e:
        print(f"⚠ Error loading background music: {e}")
        return None


def create_variable_volume_background_music(base_audio, timeline_segments):
    """
    Create background music with variable volume based on segment content.
    Lower volume during text/narration, higher during video clips.
    
    Args:
        base_audio: The base background music AudioClip
        timeline_segments: List of dicts with timing info:
            [{"start": 0, "text_duration": 2, "clips_duration": 3, "has_narration": True}, ...]
    
    Returns:
        AudioClip with variable volume
    """
    if not base_audio:
        return None
    
    import numpy as np
    
    # Create volume variation function
    def volume_function(t):
        """Return volume multiplier for time t (handles both scalar and array inputs)"""
        # Handle array inputs (batch processing)
        is_array = isinstance(t, np.ndarray)
        t_array = np.atleast_1d(t)
        volumes = np.full_like(t_array, 0.65, dtype=float)  # Default volume (intro/outro)
        
        for seg in timeline_segments:
            seg_start = seg["start"]
            text_end = seg_start + seg["text_duration"]
            seg_end = seg_start + seg["text_duration"] + seg["clips_duration"]
            
            # Find times within this segment
            in_segment = (t_array >= seg_start) & (t_array < seg_end)
            
            if seg["has_narration"]:
                # During text with narration: moderate volume
                in_text = in_segment & (t_array < text_end)
                volumes[in_text] = 0.45
                
                # During video clips: high volume
                in_clips = in_segment & (t_array >= text_end)
                volumes[in_clips] = 0.9
            else:
                # No narration in this segment: use high volume throughout
                volumes[in_segment] = 0.9
        
        # Return scalar if input was scalar, array otherwise
        return volumes if is_array else volumes[0]
    
    # Create a new audio clip with variable volume by modifying the frame function
    original_frame_function = base_audio.get_frame
    
    def variable_volume_frame_function(t):
        """Get audio frame with variable volume applied"""
        frame = original_frame_function(t)
        volume = volume_function(t)
        
        # Handle stereo audio (volume needs to be broadcast correctly)
        if len(frame.shape) > 1:
            # Stereo: shape is (n_samples, 2)
            volume = np.atleast_1d(volume)
            if len(volume.shape) == 1:
                volume = volume[:, np.newaxis]  # Add channel dimension
        
        return frame * volume
    
    # Create new audio clip with the modified frame function
    variable_audio = base_audio.with_updated_frame_function(variable_volume_frame_function)
    
    return variable_audio


def create_outro(duration=4, video_size=VIDEO_SIZE, wallpaper=None, narration=None, mobile_mode=False):
    """Create the final outro segment with logo and call-to-action"""
    # Auto-scale font sizes based on resolution
    base_cta_font_size = int(video_size[1] / 10)   # CTA text
    base_url_font_size = int(video_size[1] / 14)   # URL text
    
    # For mobile: half the base size, then 50% larger (0.5 * 1.5 = 0.75 of original)
    if mobile_mode:
        cta_font_size = int(base_cta_font_size / 2 * 1.5)
        url_font_size = int(base_url_font_size / 2 * 1.5)
    else:
        cta_font_size = base_cta_font_size
        url_font_size = base_url_font_size
    
    # Auto-scale stroke width based on resolution
    stroke_width = max(1, int(video_size[1] / 180))  # Scales with height, min 1px
    
    font = resolve_font()
    
    # Use provided wallpaper or default
    wallpaper_path = wallpaper if wallpaper is not None else WALLPAPER_ANIMATED
    
    # Animated wallpaper background
    bg = load_animated_wallpaper(wallpaper_path, duration, video_size, mobile_mode=mobile_mode)
    
    elements = [bg]
    
    # Try to load the game logo
    if os.path.exists(LOGO_FILE):
        try:
            logo = ImageClip(LOGO_FILE)
            # Scale logo to fit nicely
            # Mobile: 95% width, Desktop: 60% width
            if mobile_mode:
                max_width = int(video_size[0] * 0.95)
                max_height = int(video_size[1] * 0.4)
            else:
                max_width = int(video_size[0] * 0.6)
                max_height = int(video_size[1] * 0.4)
            
            # Calculate scaling
            scale = min(max_width / logo.w, max_height / logo.h)
            logo = logo.resized(scale)
            
            # Position logo in upper-center area
            logo = (
                logo
                .with_duration(duration)
                .with_position(("center", int(video_size[1] * 0.2)))
            )
            elements.append(logo)
            
            # Adjust text positions to be below logo
            cta_y_pos = int(video_size[1] * 0.6)
            url_y_pos = int(video_size[1] * 0.75)
            
        except Exception as e:
            print(f"⚠ Could not load logo: {e}, using text fallback")
            # Fallback to text if logo fails
            cta_y_pos = int(video_size[1] * 0.5)
            url_y_pos = int(video_size[1] * 0.68)
    else:
        print(f"⚠ Logo not found: {LOGO_FILE}")
        # No logo, use text-only layout
        cta_y_pos = int(video_size[1] * 0.5)
        url_y_pos = int(video_size[1] * 0.68)
    
    # Call to action - bold and clean with black stroke
    cta = (
        TextClip(
            text="SIGN UP FOR FREE",
            font=font,
            font_size=cta_font_size,
            color="white",
            text_align="center",
            stroke_color="black",
            stroke_width=stroke_width,
        )
        .with_duration(duration)
        .with_position(("center", cta_y_pos))
    )
    elements.append(cta)
    
    # Website URL with black stroke
    url = (
        TextClip(
            text="www.TheNinja-RPG.com",
            font=font,
            font_size=url_font_size,
            color="white",
            text_align="center",
            stroke_color="black",
            stroke_width=stroke_width,
        )
        .with_duration(duration)
        .with_position(("center", url_y_pos))
    )
    elements.append(url)
    
    # Composite all elements
    outro = CompositeVideoClip(elements, size=video_size)
    outro = outro.with_effects([vfx.FadeIn(0.5)])
    
    # Add narration audio if provided
    if narration and os.path.exists(narration):
        try:
            narration_audio = load_narration(narration, duration)
            
            # Attach narration to the outro
            outro = outro.with_audio(narration_audio)
            print(f"  → Added outro narration: {os.path.basename(narration)}")
        except Exception as e:
            print(f"  ⚠ Could not load outro narration {narration}: {e}")
    elif narration:
        print(f"  ⚠ Outro narration not found: {narration}")
    
    return outro


def create_trailer(preview_mode=False, mobile_mode=False):
    """Main function to create the complete trailer"""
    # Adjust settings for preview mode and mobile mode
    if mobile_mode:
        # Mobile uses vertical resolution (flip width and height)
        base_video_size = (1080, 1920)  # Vertical for mobile
        output_suffix = "_mobile"
    else:
        # Desktop uses horizontal resolution
        base_video_size = VIDEO_SIZE
        output_suffix = ""
    
    if preview_mode:
        # Scale down for preview while maintaining aspect ratio
        if mobile_mode:
            video_size = (360, 640)  # Vertical preview
        else:
            video_size = (640, 360)  # Horizontal preview
        fps = 10  # Very low FPS
        preset = "ultrafast"  # Fastest encoding
        bitrate = "1000k"  # Lower bitrate
        threads = 8
        output_file = f"theninja_rpg_trailer{output_suffix}_preview.mp4"
        mode_str = "MOBILE " if mobile_mode else ""
        print(f"Creating TheNinja-RPG Trailer ({mode_str}PREVIEW MODE)...")
        print(f"⚡ Using fast preview settings for quick iteration ({video_size[0]}x{video_size[1]})")
    else:
        video_size = base_video_size
        fps = FPS
        preset = "medium"
        bitrate = "8000k"
        threads = 8
        output_file = f"theninja_rpg_trailer{output_suffix}.mp4"
        mode_str = "MOBILE " if mobile_mode else ""
        print(f"Creating TheNinja-RPG {mode_str}Trailer...")
    
    # Calculate total duration from segments
    total_segment_duration = sum(item["duration"] for item in TIMELINE)
    total_with_intro_outro = 0.5 + total_segment_duration + 4  # fade-in + segments + outro
    
    print(f"Target duration: ~{int(total_with_intro_outro)} seconds ({total_segment_duration}s content + intro/outro)")
    print(f"Resolution: {video_size[0]}x{video_size[1]}")
    print(f"FPS: {fps}")
    print(f"Preset: {preset}")
    print()
    
    # Create all segments and track timing for variable background music
    segments = []
    segment_timings = []
    current_time = 0
    
    # Fade in from black
    fade_in_duration = 0.5
    fade_in = ColorClip(size=video_size, color=(0, 0, 0), duration=fade_in_duration)
    fade_in = fade_in.with_effects([vfx.FadeOut(0.5)])
    segments.append(fade_in)
    current_time += fade_in_duration
    
    # Create timeline segments and track their timing
    for i, timeline_item in enumerate(TIMELINE):
        print(f"Creating segment {i+1}/{len(TIMELINE)} ({timeline_item['duration']}s): {timeline_item['text'][:40]}...")
        segment = create_segment(timeline_item, video_size=video_size, mobile_mode=mobile_mode)
        segments.append(segment)
        
        # Calculate text and clips durations for this segment
        total_duration = timeline_item["duration"]
        text_duration = TEXT_DURATION
        clips_duration = total_duration - text_duration
        has_narration = "narration" in timeline_item
        
        segment_timings.append({
            "start": current_time,
            "text_duration": text_duration,
            "clips_duration": clips_duration,
            "has_narration": has_narration,
        })
        current_time += total_duration
    
    # Create outro
    print("Creating outro segment...")
    outro = create_outro(duration=8, video_size=video_size, narration=OUTRO_NARRATION, mobile_mode=mobile_mode)
    segments.append(outro)
    
    # Concatenate all segments
    print("Concatenating all segments...")
    final_trailer = concatenate_videoclips(segments, method="compose")
    
    print(f"Final trailer duration: {final_trailer.duration:.2f} seconds")
    
    # Load and mix audio: background music + narration from segments
    print("\nPreparing audio mix...")
    base_background_audio = load_background_music(final_trailer.duration)
    
    if base_background_audio:
        # Create variable volume background music based on segment timing
        print("Creating variable volume background music...")
        variable_bg_audio = create_variable_volume_background_music(
            base_background_audio, 
            segment_timings
        )
        
        # Check if the final trailer has audio from narrations
        if final_trailer.audio is not None:
            print("✓ Narration audio detected in segments")
            # Mix narration with variable-volume background music
            mixed_audio = CompositeAudioClip([variable_bg_audio, final_trailer.audio])
            final_trailer = final_trailer.with_audio(mixed_audio)
            print("✓ Mixed narration with variable-volume background music")
            print("  - Lower volume during text/narration")
            print("  - Higher volume during video clips")
        else:
            # No narration, just use variable-volume background music
            final_trailer = final_trailer.with_audio(variable_bg_audio)
            print("✓ Variable-volume background music attached to trailer")
    else:
        if final_trailer.audio is not None:
            print("✓ Using narration audio only (no background music)")
        else:
            print("⚠ Trailer will be created without audio")
    
    # Export the final video
    print(f"\nExporting to {output_file}...")
    final_trailer.write_videofile(
        output_file,
        fps=fps,
        codec="libx264",
        audio_codec="aac",
        preset=preset,
        threads=threads,
        bitrate=bitrate,
    )
    
    # Clean up
    final_trailer.close()
    
    print(f"\n✓ Trailer created successfully: {output_file}")
    print(f"Duration: {final_trailer.duration:.2f} seconds")
    
    if preview_mode:
        print("\n⚡ Preview mode complete! Use without --preview for final high-quality render.")


if __name__ == "__main__":
    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description="Create TheNinja-RPG game trailer with MoviePy",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python gameTrailer.py                    # Create full high-quality trailer (1080p horizontal)
  python gameTrailer.py --preview          # Create quick preview (360p, ~5x faster)
  python gameTrailer.py --mobile           # Create mobile trailer (1080x1920 vertical)
  python gameTrailer.py --mobile --preview # Create mobile preview (360x640 vertical)
  
Note: Trailer duration is automatically calculated from segment durations in TIMELINE.
      Mobile mode uses the "mobile_clips" entry from timeline items when available, falling back to "clips".
        """
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Create a quick low-quality preview for faster iteration (360p, 10fps, ultrafast preset)"
    )
    parser.add_argument(
        "--mobile",
        action="store_true",
        help="Create mobile version with vertical resolution (1080x1920) using mobile_clips from timeline"
    )
    args = parser.parse_args()
    
    # Create clips directory if it doesn't exist
    os.makedirs(CLIPS_DIR, exist_ok=True)
    
    print("=" * 60)
    print("TheNinja-RPG Game Trailer Generator")
    print("=" * 60)
    print()
    print(f"Looking for video clips in: {os.path.abspath(CLIPS_DIR)}")
    print()
    
    
    # Check for background music
    if os.path.exists(BACKGROUND_MUSIC):
        print(f"Background music: ✓ {BACKGROUND_MUSIC}")
    else:
        print(f"Background music: ⚠ {BACKGROUND_MUSIC} (not found)")
    
    # Check for logo
    if os.path.exists(LOGO_FILE):
        print(f"Logo: ✓ {LOGO_FILE}")
    else:
        print(f"Logo: ⚠ {LOGO_FILE} (not found, will use text fallback)")
    
    # Check for custom font
    if os.path.exists(FONT_FILE):
        print(f"Font: ✓ {FONT_FILE}")
    else:
        print(f"Font: ⚠ {FONT_FILE} (not found, will use Impact fallback)")
    
    print()
    print("Starting trailer creation...")
    print()
    
    try:
        create_trailer(preview_mode=args.preview, mobile_mode=args.mobile)
    except Exception as e:
        print(f"\n✗ Error creating trailer: {e}")
        import traceback
        traceback.print_exc()