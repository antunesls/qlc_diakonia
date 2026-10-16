/*
  Q Light Controller Plus
  webaccesscockpit.cpp

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

#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QColor>
#include <QTimer>
#include <QDebug>

#include "webaccesscockpit.h"
#include "qhttpconnection.h"
#include "qlcconfig.h"

#include "doc.h"
#include "fixture.h"
#include "fixturegroup.h"
#include "channelsgroup.h"
#include "qlcfixturedef.h"
#include "qlcfixturemode.h"
#include "qlcchannel.h"
#include "qlccapability.h"
#include "inputoutputmap.h"
#include "mastertimer.h"
#include "universe.h"
#include "function.h"
#include "chaser.h"
#include "chaserstep.h"
#include "chaseraction.h"
#include "sequence.h"
#include "collection.h"
#include "show.h"
#include "track.h"
#include "showfunction.h"
#include "simpledesk.h"

#define UNIVERSE_PUSH_INTERVAL_MS   40   // 25 Hz
#define SHOW_PUSH_INTERVAL_MS       250  // 4 Hz
#define DOC_CHANGED_DELAY_MS        300

static QByteArray toJson(const QJsonObject &obj)
{
    return QJsonDocument(obj).toJson(QJsonDocument::Compact);
}

WebAccessCockpit::WebAccessCockpit(Doc *doc, SimpleDesk *sd, QObject *parent)
    : QObject(parent)
    , m_doc(doc)
    , m_sd(sd)
{
    m_universeTimer = new QTimer(this);
    m_universeTimer->setInterval(UNIVERSE_PUSH_INTERVAL_MS);
    connect(m_universeTimer, SIGNAL(timeout()), this, SLOT(slotUniverseTimer()));

    m_showTimer = new QTimer(this);
    m_showTimer->setInterval(SHOW_PUSH_INTERVAL_MS);
    connect(m_showTimer, SIGNAL(timeout()), this, SLOT(slotShowTimer()));
    m_showTimer->start();

    // coalesce bursts of document changes (e.g. project loading) into one notification
    m_docChangedTimer = new QTimer(this);
    m_docChangedTimer->setSingleShot(true);
    m_docChangedTimer->setInterval(DOC_CHANGED_DELAY_MS);
    connect(m_docChangedTimer, &QTimer::timeout, this, [this]() { emit broadcast("DOC_CHANGED"); });

    connect(m_doc, SIGNAL(loaded()), this, SLOT(slotDocLoaded()));
    connect(m_doc, SIGNAL(fixtureAdded(quint32)), this, SLOT(slotDocChanged()));
    connect(m_doc, SIGNAL(fixtureRemoved(quint32)), this, SLOT(slotDocChanged()));
    connect(m_doc, SIGNAL(fixtureChanged(quint32)), this, SLOT(slotDocChanged()));
    connect(m_doc, SIGNAL(fixtureGroupAdded(quint32)), this, SLOT(slotDocChanged()));
    connect(m_doc, SIGNAL(fixtureGroupRemoved(quint32)), this, SLOT(slotDocChanged()));
    connect(m_doc, SIGNAL(fixtureGroupChanged(quint32)), this, SLOT(slotDocChanged()));
    connect(m_doc, SIGNAL(functionAdded(quint32)), this, SLOT(slotFunctionAdded(quint32)));
    connect(m_doc, SIGNAL(functionRemoved(quint32)), this, SLOT(slotDocChanged()));
    connect(m_doc, SIGNAL(functionChanged(quint32)), this, SLOT(slotDocChanged()));
    connect(m_doc, SIGNAL(functionNameChanged(quint32)), this, SLOT(slotDocChanged()));

    slotDocLoaded();
}

WebAccessCockpit::~WebAccessCockpit()
{
}

/*********************************************************************
 * HTTP JSON resources
 *********************************************************************/

QByteArray WebAccessCockpit::httpJson(const QString &path)
{
    if (path == "/api/info.json")
        return infoJson();
    if (path == "/api/fixtures.json")
        return fixturesJson();
    if (path == "/api/groups.json")
        return groupsJson();
    if (path == "/api/functions.json")
        return functionsJson();
    return QByteArray();
}

QByteArray WebAccessCockpit::infoJson() const
{
    QJsonObject root;
    root["apiVersion"] = QString(COCKPIT_API_VERSION);
    root["appName"] = QString(APPNAME);
    root["appVersion"] = QString(APPVERSION);
    root["workspace"] = m_doc->workspacePath();
    root["blackout"] = m_doc->inputOutputMap()->blackout();
    root["grandMaster"] = int(m_doc->inputOutputMap()->grandMasterValue());

    QJsonArray universes;
    QStringList names = m_doc->inputOutputMap()->universeNames();
    for (int i = 0; i < names.count(); i++)
    {
        QJsonObject uni;
        uni["id"] = i;
        uni["name"] = names.at(i);
        universes.append(uni);
    }
    root["universes"] = universes;

    return toJson(root);
}

static QJsonObject capabilityToJson(const QLCCapability *cap)
{
    QJsonObject obj;
    obj["min"] = int(cap->min());
    obj["max"] = int(cap->max());
    obj["name"] = cap->name();
    obj["presetType"] = int(cap->presetType());

    if (cap->presetType() == QLCCapability::SingleColor ||
        cap->presetType() == QLCCapability::DoubleColor)
    {
        QColor c1 = cap->resource(0).value<QColor>();
        if (c1.isValid())
            obj["color1"] = c1.name();
        if (cap->presetType() == QLCCapability::DoubleColor)
        {
            QColor c2 = cap->resource(1).value<QColor>();
            if (c2.isValid())
                obj["color2"] = c2.name();
        }
    }
    return obj;
}

QByteArray WebAccessCockpit::fixturesJson() const
{
    QJsonArray fixtures;

    for (Fixture *fxi : m_doc->fixtures())
    {
        QJsonObject fx;
        fx["id"] = int(fxi->id());
        fx["name"] = fxi->name();
        fx["type"] = fxi->typeString();
        fx["universe"] = int(fxi->universe());
        fx["address"] = int(fxi->address());       // zero-based
        fx["channelsCount"] = int(fxi->channels());
        fx["heads"] = fxi->heads();

        QLCFixtureDef *def = fxi->fixtureDef();
        QLCFixtureMode *mode = fxi->fixtureMode();
        fx["manufacturer"] = def ? def->manufacturer() : QString();
        fx["model"] = def ? def->model() : QString();
        fx["mode"] = mode ? mode->name() : QString();

        QJsonArray channels;
        for (quint32 i = 0; i < fxi->channels(); i++)
        {
            const QLCChannel *ch = fxi->channel(i);
            if (ch == nullptr)
                continue;

            QJsonObject chObj;
            chObj["index"] = int(i);
            chObj["name"] = ch->name();
            chObj["group"] = QLCChannel::groupToString(ch->group());
            chObj["groupId"] = int(ch->group());
            chObj["colour"] = QLCChannel::colourToString(ch->colour());
            chObj["controlByte"] = int(ch->controlByte());
            chObj["default"] = int(ch->defaultValue());

            QJsonArray caps;
            for (const QLCCapability *cap : ch->capabilities())
                caps.append(capabilityToJson(cap));
            chObj["capabilities"] = caps;

            channels.append(chObj);
        }
        fx["channels"] = channels;
        fixtures.append(fx);
    }

    QJsonObject root;
    root["fixtures"] = fixtures;
    return toJson(root);
}

QByteArray WebAccessCockpit::groupsJson() const
{
    QJsonArray fxGroups;
    for (FixtureGroup *grp : m_doc->fixtureGroups())
    {
        QJsonObject g;
        g["id"] = int(grp->id());
        g["name"] = grp->name();
        g["width"] = grp->size().width();
        g["height"] = grp->size().height();

        QJsonArray heads;
        QMap<QLCPoint, GroupHead> headsMap = grp->headsMap();
        QMap<QLCPoint, GroupHead>::const_iterator it = headsMap.constBegin();
        for (; it != headsMap.constEnd(); ++it)
        {
            QJsonObject h;
            h["x"] = it.key().x();
            h["y"] = it.key().y();
            h["fixtureId"] = int(it.value().fxi);
            h["head"] = it.value().head;
            heads.append(h);
        }
        g["heads"] = heads;
        fxGroups.append(g);
    }

    QJsonArray chGroups;
    for (ChannelsGroup *grp : m_doc->channelsGroups())
    {
        QJsonObject g;
        g["id"] = int(grp->id());
        g["name"] = grp->name();
        QJsonArray chans;
        for (const SceneValue &sv : grp->getChannels())
        {
            QJsonObject c;
            c["fixtureId"] = int(sv.fxi);
            c["channel"] = int(sv.channel);
            chans.append(c);
        }
        g["channels"] = chans;
        chGroups.append(g);
    }

    QJsonObject root;
    root["fixtureGroups"] = fxGroups;
    root["channelsGroups"] = chGroups;
    return toJson(root);
}

QByteArray WebAccessCockpit::functionsJson() const
{
    QJsonArray functions;

    for (Function *f : m_doc->functions())
    {
        if (f == nullptr || f->isVisible() == false)
            continue;

        QJsonObject fo;
        fo["id"] = int(f->id());
        fo["name"] = f->name();
        fo["type"] = f->typeString();
        fo["typeId"] = int(f->type());
        fo["path"] = f->path(true);
        fo["running"] = f->isRunning();
        fo["paused"] = f->isPaused();
        fo["fadeIn"] = int(f->fadeInSpeed());
        fo["fadeOut"] = int(f->fadeOutSpeed());
        fo["duration"] = int(f->duration());
        fo["totalDuration"] = qint64(f->totalDuration());

        if (f->type() == Function::ChaserType || f->type() == Function::SequenceType)
        {
            Chaser *chaser = qobject_cast<Chaser *>(f);
            fo["currentStep"] = f->isRunning() ? chaser->currentStepIndex() : -1;
            if (f->type() == Function::SequenceType)
                fo["boundSceneId"] = int(qobject_cast<Sequence *>(f)->boundSceneID());

            QJsonArray steps;
            QList<ChaserStep> stepsList = chaser->steps();
            for (int i = 0; i < stepsList.count(); i++)
            {
                const ChaserStep &step = stepsList.at(i);
                QJsonObject so;
                so["index"] = i;
                so["functionId"] = int(step.fid);
                Function *sf = m_doc->function(step.fid);
                so["functionName"] = sf ? sf->name() : QString();
                so["fadeIn"] = int(step.fadeIn);
                so["hold"] = int(step.hold);
                so["fadeOut"] = int(step.fadeOut);
                so["duration"] = int(step.duration);
                so["note"] = step.note;
                steps.append(so);
            }
            fo["steps"] = steps;
        }
        else if (f->type() == Function::CollectionType)
        {
            QJsonArray children;
            for (quint32 cid : qobject_cast<Collection *>(f)->functions())
                children.append(int(cid));
            fo["functions"] = children;
        }
        else if (f->type() == Function::ShowType)
        {
            Show *show = qobject_cast<Show *>(f);
            fo["elapsed"] = f->isRunning() ? qint64(f->elapsed()) : 0;

            QJsonArray tracks;
            for (Track *track : show->tracks())
            {
                QJsonObject to;
                to["id"] = int(track->id());
                to["name"] = track->name();
                QJsonArray items;
                for (ShowFunction *sf : track->showFunctions())
                {
                    QJsonObject io;
                    io["functionId"] = int(sf->functionID());
                    Function *tf = m_doc->function(sf->functionID());
                    io["functionName"] = tf ? tf->name() : QString();
                    io["startTime"] = qint64(sf->startTime());
                    io["duration"] = qint64(sf->duration(m_doc));
                    items.append(io);
                }
                to["functions"] = items;
                tracks.append(to);
            }
            fo["tracks"] = tracks;
        }

        functions.append(fo);
    }

    QJsonObject root;
    root["functions"] = functions;
    return toJson(root);
}

/*********************************************************************
 * WebSocket commands
 *********************************************************************/

bool WebAccessCockpit::handleApiCommand(QHttpConnection *conn, const QStringList &cmdList, bool canControlDMX)
{
    if (conn == nullptr || cmdList.count() < 2)
        return false;

    const QString &cmd = cmdList[1];

    if (cmd == "getApiVersion")
    {
        conn->webSocketWrite(QString("QLC+API|getApiVersion|%1").arg(COCKPIT_API_VERSION));
        return true;
    }
    else if (cmd == "setFixtureChannel")
    {
        // QLC+API|setFixtureChannel|<fixtureID>|<channelIndex>|<value>
        if (!canControlDMX || cmdList.count() < 5)
            return true;
        setFixtureChannel(cmdList[2].toUInt(), cmdList[3].toUInt(), cmdList[4].toInt());
        return true;
    }
    else if (cmd == "setFixtureChannels")
    {
        // QLC+API|setFixtureChannels|<fixtureID>|<ch>:<val>,<ch>:<val>,...
        if (!canControlDMX || cmdList.count() < 4)
            return true;
        quint32 fxID = cmdList[2].toUInt();
        const QStringList pairs = cmdList[3].split(",", Qt::SkipEmptyParts);
        for (const QString &pair : pairs)
        {
            QStringList kv = pair.split(":");
            if (kv.count() == 2)
                setFixtureChannel(fxID, kv[0].toUInt(), kv[1].toInt());
        }
        return true;
    }
    else if (cmd == "releaseFixture")
    {
        // QLC+API|releaseFixture|<fixtureID>  -> drop the Simple Desk overrides of a fixture
        if (!canControlDMX || cmdList.count() < 3)
            return true;
        Fixture *fxi = m_doc->fixture(cmdList[2].toUInt());
        if (fxi == nullptr)
            return true;
        for (quint32 i = 0; i < fxi->channels(); i++)
            m_sd->resetAbsoluteChannel(fxi->universeAddress() + i);
        return true;
    }
    else if (cmd == "subscribeUniverse")
    {
        // QLC+API|subscribeUniverse|<universe (0-based)>|<0/1>
        if (!canControlDMX || cmdList.count() < 4)
            return true;
        quint32 uni = cmdList[2].toUInt();
        if (cmdList[3].toInt() != 0)
        {
            m_subscriptions[conn].insert(uni);
            m_lastFrames[conn].remove(uni); // force a full first frame
        }
        else
        {
            m_subscriptions[conn].remove(uni);
            m_lastFrames[conn].remove(uni);
            if (m_subscriptions[conn].isEmpty())
                m_subscriptions.remove(conn);
        }

        if (m_subscriptions.isEmpty())
            m_universeTimer->stop();
        else if (!m_universeTimer->isActive())
            m_universeTimer->start();
        return true;
    }
    else if (cmd == "setFunctionIntensity")
    {
        // QLC+API|setFunctionIntensity|<functionID>|<0..255>
        if (cmdList.count() < 4)
            return true;
        setFunctionIntensity(cmdList[2].toUInt(), qBound(0, cmdList[3].toInt(), 255) / 255.0);
        return true;
    }
    else if (cmd == "pauseFunction")
    {
        // QLC+API|pauseFunction|<functionID>|<0/1>
        if (cmdList.count() < 4)
            return true;
        Function *f = m_doc->function(cmdList[2].toUInt());
        if (f != nullptr && f->isRunning())
            f->setPause(cmdList[3].toInt() != 0);
        return true;
    }
    else if (cmd == "seekFunction")
    {
        // QLC+API|seekFunction|<functionID>|<milliseconds>  (restart from the given time)
        if (cmdList.count() < 4)
            return true;
        Function *f = m_doc->function(cmdList[2].toUInt());
        if (f == nullptr)
            return true;
        bool wasPaused = f->isPaused();
        if (f->isRunning())
            f->stopAndWait();
        f->start(m_doc->masterTimer(), FunctionParent::master(), cmdList[3].toUInt());
        if (wasPaused)
            f->setPause(true);
        return true;
    }
    else if (cmd == "chaserStep")
    {
        // QLC+API|chaserStep|<functionID>|NEXT|PREV|<index>
        if (cmdList.count() < 4)
            return true;
        Chaser *chaser = qobject_cast<Chaser *>(m_doc->function(cmdList[2].toUInt()));
        if (chaser == nullptr)
            return true;

        ChaserAction action;
        action.m_masterIntensity = 1.0;
        action.m_stepIntensity = 1.0;
        action.m_fadeMode = Chaser::FromFunction;
        action.m_stepIndex = -1;

        if (cmdList[3] == "NEXT")
            action.m_action = ChaserNextStep;
        else if (cmdList[3] == "PREV")
            action.m_action = ChaserPreviousStep;
        else
        {
            action.m_action = ChaserSetStepIndex;
            action.m_stepIndex = cmdList[3].toInt();
        }

        if (chaser->isRunning())
        {
            chaser->setAction(action);
        }
        else
        {
            if (action.m_action != ChaserSetStepIndex)
            {
                action.m_action = ChaserSetStepIndex;
                action.m_stepIndex = 0;
            }
            chaser->setAction(action);
            chaser->start(m_doc->masterTimer(), FunctionParent::master());
        }
        return true;
    }
    else if (cmd == "stopAllFunctions")
    {
        m_doc->masterTimer()->stopAllFunctions();
        return true;
    }
    else if (cmd == "blackout")
    {
        // QLC+API|blackout|<0/1>   (no argument: query only)
        if (cmdList.count() > 2)
            m_doc->inputOutputMap()->requestBlackout(cmdList[2].toInt() != 0 ?
                                                     InputOutputMap::BlackoutRequestOn :
                                                     InputOutputMap::BlackoutRequestOff);
        else
            conn->webSocketWrite(QString("BLACKOUT|%1").arg(m_doc->inputOutputMap()->blackout() ? 1 : 0));
        return true;
    }

    return false;
}

void WebAccessCockpit::connectionClosed(QHttpConnection *conn)
{
    m_subscriptions.remove(conn);
    m_lastFrames.remove(conn);
    if (m_subscriptions.isEmpty())
        m_universeTimer->stop();
}

void WebAccessCockpit::setFixtureChannel(quint32 fxID, quint32 channel, int value)
{
    Fixture *fxi = m_doc->fixture(fxID);
    if (fxi == nullptr || channel >= fxi->channels())
        return;
    m_sd->setAbsoluteChannelValue(fxi->universeAddress() + channel, uchar(qBound(0, value, 255)));
}

void WebAccessCockpit::setFunctionIntensity(quint32 fid, qreal value)
{
    Function *f = m_doc->function(fid);
    if (f == nullptr)
        return;

    int overrideId = m_intensityOverrides.value(fid, -1);
    if (overrideId < 0)
    {
        overrideId = f->requestAttributeOverride(Function::Intensity, value);
        m_intensityOverrides[fid] = overrideId;
    }
    else
    {
        f->adjustAttribute(value, overrideId);
    }
}

/*********************************************************************
 * Pushes
 *********************************************************************/

void WebAccessCockpit::slotUniverseTimer()
{
    if (m_subscriptions.isEmpty())
        return;

    // take one snapshot of every universe somebody is subscribed to
    QSet<quint32> needed;
    for (const QSet<quint32> &set : m_subscriptions)
        needed.unite(set);

    QMap<quint32, QByteArray> snapshot;
    QList<Universe *> universes = m_doc->inputOutputMap()->claimUniverses();
    for (quint32 uni : needed)
    {
        if (uni < quint32(universes.count()))
        {
            const QByteArray *values = universes.at(uni)->postGMValues();
            if (values != nullptr)
                snapshot[uni] = QByteArray(values->constData(), values->size());
        }
    }
    m_doc->inputOutputMap()->releaseUniverses(false);

    QHash<QHttpConnection *, QSet<quint32>>::const_iterator it = m_subscriptions.constBegin();
    for (; it != m_subscriptions.constEnd(); ++it)
    {
        QHttpConnection *conn = it.key();
        QMap<quint32, QByteArray> &last = m_lastFrames[conn];
        for (quint32 uni : it.value())
        {
            if (!snapshot.contains(uni))
                continue;
            const QByteArray &frame = snapshot[uni];
            if (last.value(uni) == frame)
                continue;
            last[uni] = frame;
            conn->webSocketWrite(QString("UNIVERSE|%1|%2")
                                 .arg(uni)
                                 .arg(QString::fromLatin1(frame.toBase64())));
        }
    }
}

void WebAccessCockpit::slotShowTimer()
{
    for (Function *f : m_doc->functionsByType(Function::ShowType))
    {
        if (f->isRunning())
            emit broadcast(QString("SHOW_TIME|%1|%2|%3")
                           .arg(f->id()).arg(f->elapsed()).arg(f->isPaused() ? 1 : 0));
    }
}

void WebAccessCockpit::slotDocLoaded()
{
    m_intensityOverrides.clear();
    m_connectedChasers.clear();
    for (Function *f : m_doc->functions())
        connectChaser(f->id());
    slotDocChanged();
}

void WebAccessCockpit::slotDocChanged()
{
    m_docChangedTimer->start();
}

void WebAccessCockpit::slotFunctionAdded(quint32 fid)
{
    connectChaser(fid);
    slotDocChanged();
}

void WebAccessCockpit::connectChaser(quint32 fid)
{
    if (m_connectedChasers.contains(fid))
        return;
    Chaser *chaser = qobject_cast<Chaser *>(m_doc->function(fid));
    if (chaser == nullptr)
        return;
    m_connectedChasers.insert(fid);
    connect(chaser, SIGNAL(currentStepChanged(int)), this, SLOT(slotChaserStepChanged(int)));
}

void WebAccessCockpit::slotChaserStepChanged(int stepNumber)
{
    Chaser *chaser = qobject_cast<Chaser *>(sender());
    if (chaser == nullptr)
        return;
    emit broadcast(QString("CHASER_STEP|%1|%2").arg(chaser->id()).arg(stepNumber));
}
