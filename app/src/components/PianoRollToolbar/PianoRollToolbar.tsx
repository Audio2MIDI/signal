import styled from "@emotion/styled"
import { FC } from "react"
import { useAudio2MidiEditor } from "../../hooks/useAudio2MidiEditor"
import { InstrumentBrowser } from "../InstrumentBrowser/InstrumentBrowser"
import { AutoScrollButton } from "../Toolbar/AutoScrollButton"
import { QuantizeSelector } from "../Toolbar/QuantizeSelector/QuantizeSelector"
import { Toolbar } from "../Toolbar/Toolbar"
import { TrackListMenuButton } from "../TrackList/TrackListMenuButton"
import { EventListButton } from "./EventListButton"
import { InstrumentButton } from "./InstrumentButton"
import { PanSlider } from "./PanSlider"
import { PianoRollToolSelector } from "./PianoRollToolSelector"
import { TrackNameInput } from "./TrackNameInput"
import { VolumeSlider } from "./VolumeSlider"

const Spacer = styled.div`
  width: 1rem;
`

const FlexibleSpacer = styled.div`
  flex-grow: 1;
`

export const PianoRollToolbar: FC = () => {
  const editor = useAudio2MidiEditor()
  const showProControls = !editor.isEditorRoute || editor.mode === "pro"
  return (
    <Toolbar>
      {showProControls && <TrackListMenuButton />}

      <TrackNameInput />

      {showProControls && <EventListButton />}

      <Spacer />

      {showProControls && <InstrumentButton />}
      {showProControls && <InstrumentBrowser />}

      {showProControls && <VolumeSlider />}
      {showProControls && <PanSlider />}

      <FlexibleSpacer />

      <PianoRollToolSelector />

      <QuantizeSelector />

      <AutoScrollButton />
    </Toolbar>
  )
}
