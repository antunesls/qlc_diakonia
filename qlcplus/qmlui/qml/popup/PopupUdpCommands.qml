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
    width: mainView.width * 0.7
    height: mainView.height * 0.85
    title: qsTr("Comandos UDP")

    property var actionsModel: udpCommands.actionsModel()

    /* Target lists are read when the popup opens, so that functions and
     * widgets added meanwhile show up */
    property var functionTargets: []
    property var buttonTargets: []
    property var sliderTargets: []
    property var cueListTargets: []

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

    /* The combo boxes emit their first item, or even their index, while
     * their model is still empty or loading: only real choices are stored */
    function hasValue(list, value)
    {
        for (var i = 0; i < list.length; i++)
            if (list[i].mValue === value)
                return true
        return false
    }

    onOpened:
    {
        functionTargets = udpCommands.targetsModel(1)
        buttonTargets = udpCommands.targetsModel(2)
        sliderTargets = udpCommands.targetsModel(3)
        cueListTargets = udpCommands.targetsModel(4)
    }

    contentItem:
        ColumnLayout
        {
            spacing: 8

            /* ********************** Server ********************** */
            GridLayout
            {
                Layout.fillWidth: true
                columns: 4
                rowSpacing: 5
                columnSpacing: 8

                RobotoText
                {
                    height: UISettings.listItemHeight
                    label: qsTr("Servidor UDP")
                }

                CustomCheckBox
                {
                    implicitHeight: UISettings.listItemHeight
                    implicitWidth: height
                    tooltip: qsTr("Ligar o servidor (a escolha fica salva para as próximas vezes)")
                    checked: udpCommands.enabled
                    onClicked: udpCommands.enabled = checked
                }

                RobotoText
                {
                    height: UISettings.listItemHeight
                    label: qsTr("Porta")
                }

                CustomSpinBox
                {
                    from: 1
                    to: 65535
                    value: udpCommands.port
                    onValueModified: udpCommands.port = value
                }

                RobotoText
                {
                    height: UISettings.listItemHeight
                    label: qsTr("Situação")
                }

                RobotoText
                {
                    Layout.columnSpan: 3
                    Layout.fillWidth: true
                    height: UISettings.listItemHeight
                    label: udpCommands.listening
                           ? qsTr("Escutando em %1, porta %2").arg(udpCommands.localAddresses.join(", ")).arg(udpCommands.port)
                           : (udpCommands.lastError !== "" ? qsTr("Erro: %1").arg(udpCommands.lastError) : qsTr("Parado"))
                    labelColor: udpCommands.listening ? "lightgreen" : (udpCommands.lastError !== "" ? "red" : UISettings.fgMedium)
                }

                RobotoText
                {
                    height: UISettings.listItemHeight
                    label: qsTr("Comandos diretos")
                }

                CustomCheckBox
                {
                    implicitHeight: UISettings.listItemHeight
                    implicitWidth: height
                    tooltip: qsTr("Aceitar também start, stop, toggle, button, slider, cuelist, blackout e stopall pelo nome")
                    checked: udpCommands.allowDirect
                    onClicked: udpCommands.allowDirect = checked
                }

                RobotoText
                {
                    Layout.columnSpan: 2
                    Layout.fillWidth: true
                    height: UISettings.listItemHeight
                    wrapText: true
                    fontSize: UISettings.textSizeDefault * 0.8
                    labelColor: UISettings.fgMedium
                    label: udpCommands.allowDirect
                           ? qsTr("Ex.: \"start Louvor Azul\", \"blackout on\", \"stopall\" (envie \"help\")")
                           : qsTr("Só os comandos da tabela abaixo são aceitos")
                }
            }

            /* ********************** Mappings ********************** */
            RowLayout
            {
                Layout.fillWidth: true

                RobotoText
                {
                    Layout.fillWidth: true
                    height: UISettings.listItemHeight
                    label: qsTr("Comando recebido → ação (salvo no projeto)")
                    fontBold: true
                }

                GenericButton
                {
                    label: qsTr("+ Adicionar")
                    onClicked: udpCommands.addMapping()
                }
            }

            ListView
            {
                id: mappingsView
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.preferredHeight: 3
                clip: true
                spacing: 3
                boundsBehavior: Flickable.StopAtBounds
                model: udpCommands.mappings
                ScrollBar.vertical: CustomScrollBar { }

                delegate:
                    RowLayout
                    {
                        width: mappingsView.width - 12
                        spacing: 5

                        CustomTextEdit
                        {
                            Layout.preferredWidth: mappingsView.width * 0.25
                            text: modelData.command
                            placeholderText: qsTr("ex.: louvor_azul")
                            onEditingFinished: udpCommands.setMappingCommand(index, text)
                        }

                        CustomComboBox
                        {
                            Layout.preferredWidth: mappingsView.width * 0.3
                            model: popupRoot.actionsModel
                            currValue: modelData.action
                            onValueChanged: (value) =>
                            {
                                if (popupRoot.opened && popupRoot.hasValue(model, value))
                                    udpCommands.setMappingAction(index, value)
                            }
                        }

                        CustomComboBox
                        {
                            Layout.fillWidth: true
                            visible: modelData.kind !== 0
                            model: popupRoot.targetsFor(modelData.kind)
                            currValue: modelData.target
                            onValueChanged: (value) =>
                            {
                                if (popupRoot.opened && popupRoot.hasValue(model, value))
                                    udpCommands.setMappingTarget(index, value)
                            }
                        }

                        Item
                        {
                            Layout.fillWidth: true
                            visible: modelData.kind === 0
                        }

                        IconButton
                        {
                            width: UISettings.listItemHeight
                            height: width
                            faSource: FontAwesome.fa_trash_can
                            faColor: "darkred"
                            tooltip: qsTr("Remover este comando")
                            onClicked: udpCommands.removeMapping(index)
                        }
                    }

                RobotoText
                {
                    anchors.centerIn: parent
                    visible: mappingsView.count === 0
                    labelColor: UISettings.fgMedium
                    label: qsTr("Nenhum comando ainda. Clique em \"+ Adicionar\".")
                }
            }

            /* ********************** Test ********************** */
            RowLayout
            {
                Layout.fillWidth: true
                spacing: 5

                RobotoText
                {
                    height: UISettings.listItemHeight
                    label: qsTr("Testar")
                }

                CustomTextEdit
                {
                    id: testEdit
                    Layout.fillWidth: true
                    placeholderText: qsTr("digite um comando, como se viesse pela rede")
                    onAccepted: testButton.clicked(Qt.LeftButton)
                }

                GenericButton
                {
                    id: testButton
                    label: qsTr("Executar")
                    onClicked: udpCommands.testCommand(testEdit.text)
                }
            }

            /* ********************** Log ********************** */
            RowLayout
            {
                Layout.fillWidth: true

                RobotoText
                {
                    Layout.fillWidth: true
                    height: UISettings.listItemHeight
                    label: qsTr("Log (mais recentes primeiro)")
                    fontBold: true
                }

                GenericButton
                {
                    label: qsTr("Limpar")
                    onClicked: udpCommands.clearLog()
                }
            }

            ListView
            {
                id: logView
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.preferredHeight: 2
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                model: udpCommands.log
                ScrollBar.vertical: CustomScrollBar { }

                delegate:
                    RowLayout
                    {
                        width: logView.width - 12
                        spacing: 8

                        RobotoText
                        {
                            Layout.preferredWidth: logView.width * 0.08
                            height: UISettings.listItemHeight * 0.8
                            label: modelData.time
                            labelColor: UISettings.fgMedium
                        }
                        RobotoText
                        {
                            Layout.preferredWidth: logView.width * 0.17
                            height: UISettings.listItemHeight * 0.8
                            label: modelData.source
                            labelColor: UISettings.fgMedium
                        }
                        RobotoText
                        {
                            Layout.preferredWidth: logView.width * 0.3
                            height: UISettings.listItemHeight * 0.8
                            label: modelData.command
                        }
                        RobotoText
                        {
                            Layout.fillWidth: true
                            height: UISettings.listItemHeight * 0.8
                            label: modelData.reply
                            labelColor: modelData.ok ? "lightgreen" : "#ff6060"
                        }
                    }

                RobotoText
                {
                    anchors.centerIn: parent
                    visible: logView.count === 0
                    labelColor: UISettings.fgMedium
                    label: qsTr("Nenhum comando recebido ainda")
                }
            }

            GenericButton
            {
                Layout.fillWidth: true
                label: qsTr("Fechar")
                onClicked: popupRoot.close()
            }
        }

    footer: null
}
