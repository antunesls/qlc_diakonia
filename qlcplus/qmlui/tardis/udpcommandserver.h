/*
  Q Light Controller Plus
  udpcommandserver.h

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

#ifndef UDPCOMMANDSERVER_H
#define UDPCOMMANDSERVER_H

#include <QObject>
#include <QString>
#include <QVariantList>

class QXmlStreamReader;
class QXmlStreamWriter;
class QUdpSocket;
class Function;
class VCWidget;
class App;

/** @addtogroup qmlui QLC+ QML UI
 * @{
 */

#define KXMLQLCUdpCommands QStringLiteral("UdpCommands")

/**
 * Plain text command server over UDP.
 *
 * Every datagram holds one command line (UTF-8); several lines may be sent
 * in one datagram. Each command is answered to the sender with a line
 * starting with "OK" or "ERR".
 *
 * A line is first matched against the project's command mappings (the
 * complete line, ignoring case only). A mapping whose action takes a value
 * (slider) also matches "<command> <value>". Unmapped lines are run as
 * direct commands when allowed:
 *
 *   start|stop|toggle|status <function>
 *   button <caption>              (same as a click on the VC button)
 *   press|release <caption>       (hold / let go, for flash buttons)
 *   slider <caption> <0-255|N%>
 *   cuelist <caption> play|stop|next|prev
 *   blackout on|off|toggle
 *   stopall
 *   list functions|buttons|sliders|cuelists
 *   ping | help
 *
 * Functions and widgets are referenced by numeric ID or by their complete
 * name/caption, ignoring case only.
 */
class UdpCommandServer final : public QObject
{
    Q_OBJECT

    Q_PROPERTY(bool enabled READ enabled WRITE setEnabled NOTIFY enabledChanged)
    Q_PROPERTY(int port READ port WRITE setPort NOTIFY portChanged)
    Q_PROPERTY(bool listening READ listening NOTIFY listeningChanged)
    Q_PROPERTY(QString lastError READ lastError NOTIFY listeningChanged)
    Q_PROPERTY(bool allowDirect READ allowDirect WRITE setAllowDirect NOTIFY allowDirectChanged)
    Q_PROPERTY(QVariantList mappings READ mappings NOTIFY mappingsChanged)
    Q_PROPERTY(QVariantList log READ log NOTIFY logChanged)
    Q_PROPERTY(QStringList localAddresses READ localAddresses CONSTANT)

public:
    UdpCommandServer(App *app, QObject *parent = nullptr);

    static constexpr quint16 defaultPort = 7799;

    /** What a mapped command does */
    enum MappingAction
    {
        StartFunction,
        StopFunction,
        ToggleFunction,
        ClickButton,
        PressButton,
        ReleaseButton,
        SetSlider,
        CueListPlay,
        CueListStop,
        CueListNext,
        CueListPrevious,
        BlackoutOn,
        BlackoutOff,
        BlackoutToggle,
        StopAll
    };
    Q_ENUM(MappingAction)

    /** The kind of object a mapping action targets */
    enum TargetKind
    {
        NoTarget,
        FunctionTarget,
        ButtonTarget,
        SliderTarget,
        CueListTarget
    };
    Q_ENUM(TargetKind)

    /** Start listening as requested on the command line, without
     *  touching the saved settings */
    bool startFromCommandLine(quint16 port);

    /** Execute one command line and return the reply line */
    QString execute(const QString &line);

    /*********************************************************************
     * Settings
     *********************************************************************/
public:
    bool enabled() const;
    void setEnabled(bool enable);

    int port() const;
    void setPort(int port);

    bool listening() const;
    QString lastError() const;

    bool allowDirect() const;
    void setAllowDirect(bool allow);

    QStringList localAddresses() const;

signals:
    void enabledChanged();
    void portChanged();
    void listeningChanged();
    void allowDirectChanged();

private:
    void restartSocket();

    /*********************************************************************
     * Mappings
     *********************************************************************/
public:
    QVariantList mappings() const;

    /** Mapping actions as a combo box model: mLabel, mValue, kind */
    Q_INVOKABLE QVariantList actionsModel() const;

    /** Functions or VC widgets of $kind as a combo box model */
    Q_INVOKABLE QVariantList targetsModel(int kind) const;

    Q_INVOKABLE static int targetKind(int action);

    Q_INVOKABLE void addMapping();
    Q_INVOKABLE void removeMapping(int index);
    Q_INVOKABLE void setMappingCommand(int index, QString command);
    Q_INVOKABLE void setMappingAction(int index, int action);
    Q_INVOKABLE void setMappingTarget(int index, quint32 target);

    /** Run $line as if it was received from the network */
    Q_INVOKABLE QString testCommand(QString line);

    void resetMappings();
    bool loadXML(QXmlStreamReader &root);
    bool saveXML(QXmlStreamWriter *doc) const;

signals:
    void mappingsChanged();

private:
    struct Mapping
    {
        QString command;
        MappingAction action;
        quint32 target;
    };

    const Mapping *findMapping(const QString &line, QString &value) const;
    QString runMapping(const Mapping &mapping, const QString &value);
    QString describeTarget(const Mapping &mapping) const;
    void mappingsModified();

    /*********************************************************************
     * Log
     *********************************************************************/
public:
    QVariantList log() const;
    Q_INVOKABLE void clearLog();

signals:
    void logChanged();

private:
    void appendLog(const QString &source, const QString &command, const QString &reply);

    /*********************************************************************
     * Direct commands
     *********************************************************************/
private:
    QString executeDirect(const QString &line);

    /** Resolve $ref as an ID or a complete name. Sets $error on failure */
    Function *findFunction(const QString &ref, QString &error) const;
    VCWidget *findWidget(const QString &ref, int type, QString &error) const;

    QString listItems(const QString &what) const;

protected slots:
    void slotReadyRead();

private:
    App *m_app;
    QUdpSocket *m_socket;
    bool m_enabled;
    int m_port;
    bool m_allowDirect;
    QString m_lastError;
    QList<Mapping> m_mappings;
    QVariantList m_log;
};

/** @} */

#endif
