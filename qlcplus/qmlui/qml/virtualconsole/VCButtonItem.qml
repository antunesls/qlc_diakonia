/*
  Q Light Controller Plus
  VCButtonItem.qml

  Copyright (c) Massimo Callegari

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0.txt

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import QtQuick
import QtQuick.Layouts

import org.qlcplus.classes 1.0

VCWidgetItem
{
    id: buttonRoot
    property VCButton buttonObj: null

    property int btnState: buttonObj ? buttonObj.state : VCButton.Inactive
    property int btnAction: buttonObj ? buttonObj.actionType : VCButton.Toggle
    property string activeColor: buttonObj.flashOverrides || buttonObj.flashForceLTP ? "#FF0000" : "#00FF00"

    radius: 4
    border.width: 0

    gradient: Gradient
    {
        GradientStop { position: 0 ; color: Qt.lighter(buttonRoot.color, 1.3) }
        GradientStop { position: 1 ; color: buttonRoot.color }
    }

    // color palette strip (bottom of the button)
    property var palette: buttonObj ? buttonObj.paletteColors : []
    property int paletteIdx: buttonObj ? buttonObj.paletteIndex : -1
    property bool hasPalette: palette.length > 0
    property bool selectable: palette.length > 1
    property real chipSize: Math.max(12, Math.min(22, height * 0.22))
    property real chipGap: chipSize * 0.35
    property real stripHeight: hasPalette ? chipSize + chipGap * 2 : 0

    // returns the chip index under (px, py), -1 if the point is not on a chip
    function chipAt(px, py)
    {
        if (!selectable || py < height - stripHeight - 8)
            return -1
        var idx = Math.floor((px - chipGap - 4) / (chipSize + chipGap))
        return (idx >= 0 && idx < palette.length) ? idx : -1
    }

    // true if the tap was used to pick a color instead of toggling the button
    function handlePaletteTap(px, py)
    {
        if (!hasPalette || py < height - stripHeight - 8)
            return false
        var idx = chipAt(px, py)
        if (idx >= 0)
            buttonObj.paletteIndex = idx
        return true
    }

    function checkActionType()
    {
        if (btnAction === VCButton.Flash)
            buttonIcon.source = "qrc:/flash.svg"
        else if (btnAction === VCButton.StopAll)
            buttonIcon.source = "qrc:/stopall.svg"
        else if (btnAction === VCButton.Blackout)
            buttonIcon.source = "qrc:/blackout.svg"
        else
            buttonIcon.source = ""
    }

    onBtnStateChanged:
    {
        if (btnState === VCButton.Inactive)
        {
            // activate the blink effect here
            blink.start()
        }
    }

    onButtonObjChanged:
    {
        setCommonProperties(buttonObj)
        setBgImageMargins(4)
        checkActionType()
    }
    onBtnActionChanged: checkActionType()

    Rectangle
    {
        id: activeBorder
        x: 1
        y: 1
        width: parent.width - 2
        height: parent.height - 2
        color: "transparent"
        border.width: screenPixelDensity * UISettings.scalingFactor * 0.8
        border.color: btnState === VCButton.Active ? activeColor : btnState === VCButton.Monitoring ? "orange" : "#A0A0A0"
        radius: 3

        Rectangle
        {
            id: bodyBg
            x: 3
            y: 3
            width: parent.width - 6
            height: parent.height - 6
            radius: 2
            color: "transparent"
            clip: true

            ColorAnimation on color
            {
                id: blink
                from: "black"
                to: "transparent"
                duration: 250
                running: false
            }

            Text
            {
                x: 2
                z: 2
                width: parent.width - 4
                height: parent.height - buttonRoot.stripHeight
                font: buttonObj ? buttonObj.font : Qt.font({ family: UISettings.robotoFontName })
                text: buttonObj ? buttonObj.caption : ""
                verticalAlignment: Text.AlignVCenter
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.Wrap
                lineHeight: 0.8
                color: buttonObj ? buttonObj.foregroundColor : "#111"
            }

            Row
            {
                id: chipsRow
                visible: buttonRoot.hasPalette
                z: 3
                x: buttonRoot.chipGap
                anchors.bottom: parent.bottom
                anchors.bottomMargin: buttonRoot.chipGap
                spacing: buttonRoot.chipGap

                Repeater
                {
                    model: buttonRoot.palette

                    Rectangle
                    {
                        width: buttonRoot.chipSize
                        height: width
                        radius: width / 2
                        color: modelData
                        border.width: index === buttonRoot.paletteIdx && buttonRoot.selectable ? 2 : 1
                        border.color: index === buttonRoot.paletteIdx && buttonRoot.selectable ? "white" : "#80000000"
                    }
                }
            }

            Image
            {
                id: buttonIcon
                visible: buttonObj ? (buttonObj.actionType != VCButton.Toggle) : false
                x: parent.width - 23
                y: 3
                z: 1
                width: 20
                height: 20
                source: ""
                sourceSize: Qt.size(width, height)
            }
        }
    }

    MouseArea
    {
        anchors.fill: parent
        enabled: buttonObj && !buttonObj.isDisabled
        onClicked: (mouse) =>
        {
            if (virtualConsole.editMode)
                return;

            if (buttonRoot.handlePaletteTap(mouse.x, mouse.y))
                return;

            if (buttonObj.actionType === VCButton.Toggle || buttonObj.actionType === VCButton.Blackout)
            {
                buttonObj.requestStateChange(btnState === VCButton.Active ? false : true)
            }
            else if (buttonObj.actionType !== VCButton.Flash)
            {
                buttonObj.requestStateChange(true)
                blink.start()
            }
        }
        onPressed:
        {
            if (virtualConsole.editMode)
                return;

            if (buttonObj.actionType === VCButton.Flash)
                buttonObj.requestStateChange(true)
        }
        onReleased:
        {
            if (virtualConsole.editMode)
                return;

            if (buttonObj.actionType === VCButton.Flash)
                buttonObj.requestStateChange(false)
        }
    }

    MultiPointTouchArea
    {
        anchors.fill: parent
        enabled: buttonObj && !buttonObj.isDisabled
        mouseEnabled: false
        maximumTouchPoints: 1

        onPressed:
        {
            if (virtualConsole.editMode)
                return;

            if (buttonObj.actionType === VCButton.Flash)
                buttonObj.requestStateChange(true)
        }
        onReleased: (touchPoints) =>
        {
            if (virtualConsole.editMode)
                return;

            if (touchPoints.length && buttonRoot.handlePaletteTap(touchPoints[0].x, touchPoints[0].y))
                return;

            if (buttonObj.actionType === VCButton.Flash)
                buttonObj.requestStateChange(false)
            else if (buttonObj.actionType === VCButton.Toggle || buttonObj.actionType === VCButton.Blackout)
                buttonObj.requestStateChange(btnState === VCButton.Active ? false : true)
            else
            {
                buttonObj.requestStateChange(true)
                blink.start()
            }
        }
    }

    DropArea
    {
        id: dropArea
        anchors.fill: parent
        z: 2 // this area must be above the VCWidget resize controls
        keys: [ "function" ]

        onDropped:
        {
            // attach function here
            if (drag.source.hasOwnProperty("fromFunctionManager"))
                buttonObj.functionID = drag.source.itemsList[0]
        }

        states: [
            State
            {
                when: dropArea.containsDrag
                PropertyChanges
                {
                    target: buttonRoot
                    color: UISettings.activeDropArea
                }
            }
        ]
    }
}
