/*
  Q Light Controller Plus
  PopupUdpCommands.qml

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
import QtQuick.Controls

import org.qlcplus.classes 1.0
import "."

CustomPopupDialog
{
    id: popupRoot
    width: Math.min(mainView.width * 0.8, UISettings.bigItemHeight * 14)
    height: mainView.height * 0.88
    title: qsTr("Comandos UDP")

    readonly property int rowHeight: UISettings.listItemHeight
    readonly property real smallText: UISettings.textSizeDefault * 0.85

    /* Column widths of the mappings table, shared by header and rows */
    readonly property real colCommand: mappingsView.width * 0.2
    readonly property real colAction: mappingsView.width * 0.22
    readonly property real colExample: mappingsView.width * 0.17

    property var actionsModel: udpCommands.actionsModel()
    property var functionTargets: []
    property var buttonTargets: []
    property var sliderTargets: []
    property var cueListTargets: []
    property string testReply: ""

    function targetsFor(kind)
    {
        switch (kind)
        {
            case 1: return functionTargets
            case 2: return buttonTargets
            case 3: return sliderTargets
            case 4: return cueListTargets
        }
        return []
    }

    /* A leading entry shown when a mapping has no target, or one that
     * no longer exists in the project */
    function withPlaceholder(list)
    {
        return [ { mLabel: qsTr("— escolha —"), mValue: -1 } ].concat(list)
    }

    /* The combo boxes emit their first item, or even their index, while
     * their model is still loading: only real choices are stored */
    function isChoice(list, value)
    {
        if (value === -1)
            return false
        for (var i = 0; i < list.length; i++)
            if (list[i].mValue === value)
                return true
        return false
    }

    function exampleFor(mapping)
    {
        if (mapping.command === "")
            return ""
        return mapping.action === 6 ? mapping.command + " 50%" : mapping.command
    }

    /* Target lists are read before the rows are created, so that each
     * combo box starts on its stored value. Functions and widgets added
     * meanwhile show up the next time the popup opens */
    onAboutToShow:
    {
        functionTargets = withPlaceholder(udpCommands.targetsModel(1))
        buttonTargets = withPlaceholder(udpCommands.targetsModel(2))
        sliderTargets = withPlaceholder(udpCommands.targetsModel(3))
        cueListTargets = withPlaceholder(udpCommands.targetsModel(4))
        testReply = ""
    }

    contentItem:
        ColumnLayout
        {
            spacing: 6

            /* ********************** Server ********************** */
            RobotoText
            {
                Layout.fillWidth: true
                height: popupRoot.rowHeight
                label: qsTr("Servidor")
                fontBold: true
            }

            Rectangle
            {
                Layout.fillWidth: true
                implicitHeight: serverLayout.implicitHeight + 16
                color: UISettings.bgStrong
                radius: 4

                GridLayout
                {
                    id: serverLayout
                    x: 8
                    y: 8
                    width: parent.width - 16
                    columns: 5
                    columnSpacing: 10
                    rowSpacing: 6

                    Rectangle
                    {
                        implicitWidth: popupRoot.rowHeight * 0.4
                        implicitHeight: implicitWidth
                        radius: width / 2
                        color: udpCommands.listening ? "#3ddc6b" : (udpCommands.lastError !== "" ? "#ff5050" : UISettings.bgLight)
                    }

                    RobotoText
                    {
                        Layout.fillWidth: true
                        height: popupRoot.rowHeight
                        fontBold: true
                        label: udpCommands.listening
                               ? qsTr("Ligado")
                               : (udpCommands.lastError !== "" ? qsTr("Erro: %1").arg(udpCommands.lastError) : qsTr("Desligado"))
                        labelColor: udpCommands.listening ? "#3ddc6b" : (udpCommands.lastError !== "" ? "#ff5050" : UISettings.fgLight)
                    }

                    RobotoText
                    {
                        height: popupRoot.rowHeight
                        label: qsTr("Porta")
                    }

                    CustomSpinBox
                    {
                        implicitWidth: UISettings.bigItemHeight * 1.6
                        from: 1
                        to: 65535
                        value: udpCommands.port
                        onValueModified: udpCommands.port = value
                    }

                    GenericButton
                    {
                        implicitWidth: UISettings.bigItemHeight * 1.5
                        label: udpCommands.enabled ? qsTr("Desligar") : qsTr("Ligar")
                        bgColor: udpCommands.enabled ? "#7a2a2a" : "#2a6a3a"
                        onClicked: udpCommands.enabled = !udpCommands.enabled
                    }

                    Text
                    {
                        Layout.columnSpan: 5
                        Layout.fillWidth: true
                        wrapMode: Text.Wrap
                        font.family: UISettings.robotoFontName
                        font.pixelSize: popupRoot.smallText
                        color: UISettings.fgLight
                        text: udpCommands.localAddresses.length
                              ? qsTr("Outros aparelhos enviam para: %1")
                                    .arg(udpCommands.localAddresses.map(a => a + ":" + udpCommands.port).join("   ou   "))
                              : qsTr("Nenhuma rede encontrada: só este computador (127.0.0.1:%1)").arg(udpCommands.port)
                    }

                    CustomCheckBox
                    {
                        implicitHeight: popupRoot.rowHeight * 0.8
                        implicitWidth: implicitHeight
                        checked: udpCommands.allowDirect
                        onClicked: udpCommands.allowDirect = checked
                    }

                    Text
                    {
                        Layout.columnSpan: 4
                        Layout.fillWidth: true
                        wrapMode: Text.Wrap
                        font.family: UISettings.robotoFontName
                        font.pixelSize: popupRoot.smallText
                        color: UISettings.fgMain
                        textFormat: Text.StyledText
                        text: udpCommands.allowDirect
                              ? qsTr("Aceitar também comandos diretos pelo nome: <i>start Louvor Azul</i>, <i>button BLACKOUT</i>, <i>slider PAR 1 50%</i>, <i>blackout on</i>, <i>stopall</i>, <i>help</i>")
                              : qsTr("Aceitar também comandos diretos pelo nome (desligado: só a tabela abaixo vale)")
                    }
                }
            }

            /* ********************** Mappings ********************** */
            RowLayout
            {
                Layout.fillWidth: true

                RobotoText
                {
                    Layout.fillWidth: true
                    height: popupRoot.rowHeight
                    label: qsTr("Comandos (salvos no projeto)")
                    fontBold: true
                }

                GenericButton
                {
                    label: qsTr("+ Novo comando")
                    onClicked: udpCommands.addMapping()
                }
            }

            /* Table header */
            Rectangle
            {
                Layout.fillWidth: true
                implicitHeight: popupRoot.rowHeight * 0.8
                color: UISettings.sectionHeader

                Row
                {
                    x: 6
                    height: parent.height
                    spacing: 5

                    Repeater
                    {
                        model: [
                            { t: qsTr("Comando recebido"), w: popupRoot.colCommand },
                            { t: qsTr("Ação"), w: popupRoot.colAction },
                            { t: qsTr("Alvo"), w: mappingsView.width - popupRoot.colCommand - popupRoot.colAction
                                                   - popupRoot.colExample - popupRoot.rowHeight - 32 },
                            { t: qsTr("Envie assim"), w: popupRoot.colExample }
                        ]

                        RobotoText
                        {
                            width: modelData.w
                            height: parent.height
                            label: modelData.t
                            fontSize: popupRoot.smallText
                            fontBold: true
                        }
                    }
                }
            }

            ListView
            {
                id: mappingsView
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.preferredHeight: 3
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                /* Rows exist only while the popup is open: see onAboutToShow */
                model: popupRoot.opened ? udpCommands.mappings : []
                ScrollBar.vertical: CustomScrollBar { }

                delegate:
                    Rectangle
                    {
                        width: mappingsView.width - 10
                        height: popupRoot.rowHeight + 6
                        color: index % 2 ? UISettings.bgMedium : UISettings.bgStrong

                        Row
                        {
                            x: 6
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 5

                            CustomTextEdit
                            {
                                width: popupRoot.colCommand
                                height: popupRoot.rowHeight
                                text: modelData.command
                                placeholderText: qsTr("ex.: louvor_azul")
                                onEditingFinished: udpCommands.setMappingCommand(index, text)
                            }

                            CustomComboBox
                            {
                                width: popupRoot.colAction
                                height: popupRoot.rowHeight
                                model: popupRoot.actionsModel
                                currValue: modelData.action
                                onValueChanged: (value) =>
                                {
                                    if (popupRoot.isChoice(model, value))
                                        udpCommands.setMappingAction(index, value)
                                }
                            }

                            Item
                            {
                                width: mappingsView.width - popupRoot.colCommand - popupRoot.colAction
                                       - popupRoot.colExample - popupRoot.rowHeight - 32
                                height: popupRoot.rowHeight

                                CustomComboBox
                                {
                                    anchors.fill: parent
                                    visible: modelData.kind !== 0
                                    model: popupRoot.targetsFor(modelData.kind)
                                    currValue: modelData.target
                                    onValueChanged: (value) =>
                                    {
                                        if (popupRoot.isChoice(model, value))
                                            udpCommands.setMappingTarget(index, value)
                                    }
                                }

                                RobotoText
                                {
                                    anchors.fill: parent
                                    visible: modelData.kind === 0
                                    label: qsTr("(não precisa de alvo)")
                                    labelColor: UISettings.fgMedium
                                    fontSize: popupRoot.smallText
                                }
                            }

                            RobotoText
                            {
                                width: popupRoot.colExample
                                height: popupRoot.rowHeight
                                label: popupRoot.exampleFor(modelData)
                                labelColor: "#9fd3ff"
                                fontSize: popupRoot.smallText
                            }

                            IconButton
                            {
                                width: popupRoot.rowHeight
                                height: width
                                faSource: FontAwesome.fa_trash_can
                                faColor: "#d05050"
                                tooltip: qsTr("Remover este comando")
                                onClicked: udpCommands.removeMapping(index)
                            }
                        }
                    }

                Text
                {
                    anchors.centerIn: parent
                    width: parent.width * 0.8
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.Wrap
                    visible: mappingsView.count === 0
                    font.family: UISettings.robotoFontName
                    font.pixelSize: popupRoot.smallText
                    color: UISettings.fgMedium
                    text: qsTr("Nenhum comando ainda. Clique em \"+ Novo comando\", escolha o texto que vai chegar pela rede e o que ele faz.")
                }
            }

            /* ********************** Test ********************** */
            RowLayout
            {
                Layout.fillWidth: true
                spacing: 6

                RobotoText
                {
                    height: popupRoot.rowHeight
                    label: qsTr("Testar")
                    fontBold: true
                }

                CustomTextEdit
                {
                    id: testEdit
                    Layout.fillWidth: true
                    placeholderText: qsTr("digite um comando como se viesse pela rede e tecle Enter")
                    onAccepted: popupRoot.testReply = udpCommands.testCommand(text)
                }

                GenericButton
                {
                    label: qsTr("Executar")
                    onClicked: popupRoot.testReply = udpCommands.testCommand(testEdit.text)
                }
            }

            RobotoText
            {
                Layout.fillWidth: true
                visible: popupRoot.testReply !== ""
                height: popupRoot.rowHeight * 0.8
                fontSize: popupRoot.smallText
                label: popupRoot.testReply
                labelColor: popupRoot.testReply.startsWith("OK") ? "#3ddc6b" : "#ff6060"
            }

            /* ********************** Log ********************** */
            RowLayout
            {
                Layout.fillWidth: true

                RobotoText
                {
                    Layout.fillWidth: true
                    height: popupRoot.rowHeight
                    label: qsTr("Log (mais recentes no topo)")
                    fontBold: true
                }

                GenericButton
                {
                    label: qsTr("Limpar")
                    onClicked: udpCommands.clearLog()
                }
            }

            Rectangle
            {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.preferredHeight: 2
                color: UISettings.bgStronger
                radius: 4

                ListView
                {
                    id: logView
                    anchors.fill: parent
                    anchors.margins: 4
                    clip: true
                    boundsBehavior: Flickable.StopAtBounds
                    model: udpCommands.log
                    ScrollBar.vertical: CustomScrollBar { }

                    delegate:
                        Row
                        {
                            width: logView.width - 10
                            height: popupRoot.rowHeight * 0.75
                            spacing: 8

                            Repeater
                            {
                                model: [
                                    { t: modelData.time, w: 0.09, c: UISettings.fgMedium },
                                    { t: modelData.source, w: 0.18, c: UISettings.fgMedium },
                                    { t: modelData.command, w: 0.3, c: UISettings.fgMain },
                                    { t: modelData.reply, w: 0.4, c: modelData.ok ? "#3ddc6b" : "#ff6060" }
                                ]

                                RobotoText
                                {
                                    width: logView.width * modelData.w
                                    height: popupRoot.rowHeight * 0.75
                                    label: modelData.t
                                    labelColor: modelData.c
                                    fontSize: popupRoot.smallText
                                }
                            }
                        }

                    Text
                    {
                        anchors.centerIn: parent
                        visible: logView.count === 0
                        font.family: UISettings.robotoFontName
                        font.pixelSize: popupRoot.smallText
                        color: UISettings.fgMedium
                        text: udpCommands.listening ? qsTr("Esperando comandos…") : qsTr("O servidor está desligado")
                    }
                }
            }

            GenericButton
            {
                Layout.alignment: Qt.AlignRight
                implicitWidth: UISettings.bigItemHeight * 1.5
                label: qsTr("Fechar")
                onClicked: popupRoot.close()
            }
        }

    footer: null
}
