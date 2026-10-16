/*
  Q Light Controller Plus
  webaccesscockpit.h

  Cockpit API extension: read-only JSON description of the project
  (fixtures, groups, functions) and extra WebSocket commands/pushes
  used by native remote clients (e.g. the QLC+ Cockpit Android app).

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

#ifndef WEBACCESSCOCKPIT_H
#define WEBACCESSCOCKPIT_H

#include <QObject>
#include <QHash>
#include <QMap>
#include <QSet>
#include <QByteArray>
#include <QStringList>

class QHttpConnection;
class SimpleDesk;
class QTimer;
class Doc;

#define COCKPIT_API_VERSION "cockpit-1"

class WebAccessCockpit final : public QObject
{
    Q_OBJECT
public:
    explicit WebAccessCockpit(Doc *doc, SimpleDesk *sd, QObject *parent = nullptr);
    ~WebAccessCockpit();

    /** Returns the JSON body for a /api/... path, or a null QByteArray
     *  if the path is not a Cockpit API resource */
    QByteArray httpJson(const QString &path);

    /** Handle a "QLC+API|<cmd>|..." WebSocket request.
     *  Returns true if the command belongs to the Cockpit API. */
    bool handleApiCommand(QHttpConnection *conn, const QStringList &cmdList, bool canControlDMX);

    /** Forget any state bound to a closed connection */
    void connectionClosed(QHttpConnection *conn);

    QByteArray infoJson() const;
    QByteArray fixturesJson() const;
    QByteArray groupsJson() const;
    QByteArray functionsJson() const;

signals:
    /** Emitted with a message that must be sent to every client */
    void broadcast(const QString &message);

private slots:
    void slotDocLoaded();
    void slotDocChanged();
    void slotFunctionAdded(quint32 fid);
    void slotChaserStepChanged(int stepNumber);
    void slotUniverseTimer();
    void slotShowTimer();

private:
    void connectChaser(quint32 fid);
    void setFixtureChannel(quint32 fxID, quint32 channel, int value);
    void setFunctionIntensity(quint32 fid, qreal value);

private:
    Doc *m_doc;
    SimpleDesk *m_sd;

    /** Universes each connection is subscribed to */
    QHash<QHttpConnection *, QSet<quint32>> m_subscriptions;
    /** Last frame sent to each connection, per universe */
    QHash<QHttpConnection *, QMap<quint32, QByteArray>> m_lastFrames;

    /** Function ID -> attribute override ID for intensity */
    QMap<quint32, int> m_intensityOverrides;

    QSet<quint32> m_connectedChasers;

    QTimer *m_universeTimer;
    QTimer *m_showTimer;
    QTimer *m_docChangedTimer;
};

#endif // WEBACCESSCOCKPIT_H
