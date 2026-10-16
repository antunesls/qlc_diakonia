/*
  Q Light Controller Plus
  nativeapi.cpp

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

#include <QJsonDocument>
#include <algorithm>
#include <QFileInfo>
#include <QColor>
#include <QDebug>

#include "nativeapi.h"
#include "networkmanager.h"
#include "tardis.h"
#include "app.h"

#include "doc.h"
#include "qlcconfig.h"
#include "qlcfile.h"
#include "qlcchannel.h"
#include "qlccapability.h"
#include "qlcfixturedef.h"
#include "qlcfixturemode.h"
#include "qlcfixturehead.h"
#include "qlcfixturedefcache.h"
#include "inputoutputmap.h"
#include "outputpatch.h"
#include "inputpatch.h"
#include "qlcioplugin.h"
#include "virtualconsole.h"
#include "vcpage.h"

/* Upper bound of a workspace uploaded over the network */
#define MAX_UPLOAD_SIZE (64 * 1024 * 1024)

NativeApi::NativeApi(App *app, NetworkManager *networkManager)
    : QObject(app)
    , m_app(app)
    , m_networkManager(networkManager)
{
    connect(m_networkManager, &NetworkManager::extendedRequest,
            this, &NativeApi::slotExtendedRequest);
}

QStringList NativeApi::features()
{
    return QStringList() << "project" << "fixtureLibrary" << "io"
                         << "fixtureGroupDelete" << "vcPages";
}

void NativeApi::slotExtendedRequest(QString sessionId, int actionCode, quint32 requestId,
                                    QVariantMap arguments, int accessMask)
{
    QVariant result;
    QString error;
    bool ok = false;

    qDebug() << "[NativeApi] Request" << Tardis::actionToString(actionCode)
             << "id" << requestId << "from session" << sessionId;

    switch (actionCode)
    {
        case Tardis::NetApiInfo:
            ok = apiInfo(accessMask, result, error);
        break;
        case Tardis::NetProjectSave:
            ok = projectSave(arguments, result, error);
        break;
        case Tardis::NetProjectNew:
            ok = projectNew(result, error);
        break;
        case Tardis::NetProjectLoadFile:
            ok = projectLoadFile(arguments, result, error);
        break;
        case Tardis::NetProjectUpload:
            ok = projectUpload(sessionId, arguments, result, error);
        break;
        case Tardis::NetFixtureLibraryQuery:
            ok = fixtureLibraryQuery(arguments, result, error);
        break;
        case Tardis::NetIOQuery:
            ok = ioQuery(result, error);
        break;
        case Tardis::NetIOPatch:
            ok = ioPatch(arguments, result, error);
        break;
        case Tardis::NetFixtureGroupDelete:
            ok = fixtureGroupDelete(arguments, result, error);
        break;
        case Tardis::NetVCPageAdd:
            ok = vcPageAdd(arguments, result, error);
        break;
        case Tardis::NetVCPageRemove:
            ok = vcPageRemove(arguments, result, error);
        break;
        default:
            error = QString("Unsupported request %1").arg(Tardis::actionToString(actionCode));
        break;
    }

    if (ok)
    {
        QByteArray json = QJsonDocument::fromVariant(result).toJson(QJsonDocument::Compact);
        /* fromVariant yields an empty document for scalars and null */
        m_networkManager->sendCommandResult(sessionId, requestId, true,
                                            json.isEmpty() ? QString("null") : QString::fromUtf8(json));
    }
    else
    {
        qWarning() << "[NativeApi]" << Tardis::actionToString(actionCode) << "failed:" << error;
        m_networkManager->sendCommandResult(sessionId, requestId, false, error);
    }
}

/*********************************************************************
 * Info
 *********************************************************************/

bool NativeApi::apiInfo(int accessMask, QVariant &result, QString &error)
{
    Q_UNUSED(error)
    QVariantMap info;
    info["version"] = QString(APPVERSION);
    info["apiLevel"] = apiLevel;
    info["features"] = features();
    info["accessMask"] = accessMask;
    result = info;
    return true;
}

/*********************************************************************
 * Project
 *********************************************************************/

bool NativeApi::projectSave(const QVariantMap &args, QVariant &result, QString &error)
{
    QString path = args.value("path").toString();
    if (path.isEmpty())
        path = m_app->fileName();

    if (path.isEmpty())
    {
        error = "The project has never been saved: a path is required";
        return false;
    }

    if (m_app->saveWorkspace(path) == false)
    {
        error = QString("Unable to save the project to %1").arg(path);
        return false;
    }

    /* saveWorkspace appends the extension when missing */
    if (path.endsWith(KExtWorkspace) == false)
        path += KExtWorkspace;
    m_app->setFileName(path);

    QVariantMap map;
    map["path"] = path;
    result = map;
    return true;
}

bool NativeApi::projectNew(QVariant &result, QString &error)
{
    Q_UNUSED(error)
    /* newWorkspace notifies the connected clients by itself */
    m_app->newWorkspace();
    m_app->setFileName(QString());
    result = QVariantMap();
    return true;
}

bool NativeApi::projectLoadFile(const QVariantMap &args, QVariant &result, QString &error)
{
    QString path = args.value("path").toString();
    if (path.isEmpty() || QFileInfo::exists(path) == false)
    {
        error = QString("Project file not found: %1").arg(path);
        return false;
    }

    if (m_app->loadWorkspace(path) == false)
    {
        error = QString("QLC+ could not load %1").arg(path);
        return false;
    }

    QVariantMap map;
    map["path"] = path;
    result = map;
    return true;
}

bool NativeApi::projectUpload(const QString &sessionId, const QVariantMap &args,
                              QVariant &result, QString &error)
{
    int index = args.value("index").toInt();
    int count = args.value("count").toInt();
    QByteArray data = QByteArray::fromBase64(args.value("data").toString().toLatin1());

    if (index == 0)
    {
        m_uploads.remove(sessionId);
        m_uploadNextIndex[sessionId] = 0;
    }

    if (count <= 0 || index >= count || m_uploadNextIndex.value(sessionId, -1) != index)
    {
        m_uploads.remove(sessionId);
        m_uploadNextIndex.remove(sessionId);
        error = QString("Unexpected upload chunk %1 of %2").arg(index).arg(count);
        return false;
    }

    QByteArray &buffer = m_uploads[sessionId];
    if (buffer.size() + data.size() > MAX_UPLOAD_SIZE)
    {
        m_uploads.remove(sessionId);
        m_uploadNextIndex.remove(sessionId);
        error = "The uploaded project is too large";
        return false;
    }
    buffer.append(data);
    m_uploadNextIndex[sessionId] = index + 1;

    QVariantMap map;
    map["received"] = index;

    if (index == count - 1)
    {
        QByteArray xml = m_uploads.take(sessionId);
        m_uploadNextIndex.remove(sessionId);

        if (xml.contains("<!ENTITY"))
        {
            error = "XML entities are not allowed in an uploaded project";
            return false;
        }

        m_networkManager->notifyProjectChanging();
        m_app->slotLoadDocFromMemory(xml);
        /* The uploaded content does not belong to the previous file:
         * a later save must be given an explicit path */
        m_app->setFileName(QString());
        m_networkManager->notifyProjectLoaded();
        map["loaded"] = true;
    }

    result = map;
    return true;
}

/*********************************************************************
 * Fixture library
 *********************************************************************/

static QVariantMap channelToMap(const QLCChannel *channel)
{
    QVariantMap map;
    map["name"] = channel->name();
    if (channel->preset() != QLCChannel::Custom)
        map["preset"] = QLCChannel::presetToString(channel->preset());
    map["group"] = QLCChannel::groupToString(channel->group());
    map["groupByte"] = int(channel->controlByte());
    if (channel->colour() != QLCChannel::NoColour)
        map["colour"] = QLCChannel::colourToString(channel->colour());

    QVariantList caps;
    for (const QLCCapability *cap : channel->capabilities())
    {
        QVariantMap c;
        c["min"] = int(cap->min());
        c["max"] = int(cap->max());
        c["name"] = cap->name();
        if (cap->preset() != QLCCapability::Custom)
            c["preset"] = QLCCapability::presetToString(cap->preset());
        QVariant res = cap->resource(0);
        if (res.metaType().id() == QMetaType::QColor && res.value<QColor>().isValid())
            c["color"] = res.value<QColor>().name();
        caps.append(c);
    }
    map["capabilities"] = caps;
    return map;
}

static QVariantMap fixtureDefToMap(QLCFixtureDef *def)
{
    QVariantMap map;
    map["manufacturer"] = def->manufacturer();
    map["model"] = def->model();
    map["type"] = QLCFixtureDef::typeToString(def->type());

    QVariantList channels;
    for (const QLCChannel *channel : def->channels())
        channels.append(channelToMap(channel));
    map["channels"] = channels;

    QVariantList modes;
    for (QLCFixtureMode *mode : def->modes())
    {
        QVariantMap m;
        m["name"] = mode->name();
        QStringList names;
        for (const QLCChannel *channel : mode->channels())
            names.append(channel->name());
        m["channels"] = names;

        QVariantList heads;
        for (const QLCFixtureHead &head : mode->heads())
        {
            QVariantList indexes;
            for (quint32 index : head.channels())
                indexes.append(index);
            heads.append(QVariant(indexes));
        }
        m["heads"] = heads;
        modes.append(m);
    }
    map["modes"] = modes;
    return map;
}

bool NativeApi::fixtureLibraryQuery(const QVariantMap &args, QVariant &result, QString &error)
{
    QLCFixtureDefCache *cache = m_app->doc()->fixtureDefCache();
    QString op = args.value("op").toString();

    if (op == "manufacturers")
    {
        QStringList list = cache->manufacturers();
        list.sort(Qt::CaseInsensitive);
        result = list;
        return true;
    }

    if (op == "search")
    {
        QStringList tokens = args.value("query").toString().toLower().split(' ', Qt::SkipEmptyParts);
        int limit = qBound(1, args.value("limit", 25).toInt(), 200);

        struct Match { int score; QString manufacturer; QString model; };
        QList<Match> matches;
        QMap<QString, QMap<QString, bool>> all = cache->fixtureCache();
        for (auto mIt = all.constBegin(); mIt != all.constEnd(); ++mIt)
        {
            for (auto it = mIt.value().constBegin(); it != mIt.value().constEnd(); ++it)
            {
                QString haystack = QString("%1 %2").arg(mIt.key(), it.key()).toLower();
                int score = 1;
                for (const QString &token : tokens)
                {
                    if (haystack.contains(token) == false)
                    {
                        score = 0;
                        break;
                    }
                    score += it.key().toLower().contains(token) ? 2 : 1;
                }
                if (score > 0)
                    matches.append({ score, mIt.key(), it.key() });
            }
        }
        std::sort(matches.begin(), matches.end(), [](const Match &a, const Match &b) {
            return a.score != b.score ? a.score > b.score : a.model < b.model;
        });

        QVariantList list;
        for (int i = 0; i < matches.count() && i < limit; i++)
        {
            QVariantMap entry;
            entry["manufacturer"] = matches.at(i).manufacturer;
            entry["model"] = matches.at(i).model;
            QLCFixtureDef *def = cache->fixtureDef(matches.at(i).manufacturer, matches.at(i).model);
            entry["type"] = def ? QLCFixtureDef::typeToString(def->type()) : QString();
            list.append(entry);
        }
        result = list;
        return true;
    }

    if (op == "get")
    {
        QString manufacturer = args.value("manufacturer").toString();
        QString model = args.value("model").toString();
        QLCFixtureDef *def = cache->fixtureDef(manufacturer, model);

        /* Agents rarely get the case right: fall back to a case-insensitive match */
        if (def == nullptr)
        {
            for (const QString &m : cache->manufacturers())
            {
                if (m.compare(manufacturer, Qt::CaseInsensitive) != 0)
                    continue;
                for (const QString &md : cache->models(m))
                    if (md.compare(model, Qt::CaseInsensitive) == 0)
                        def = cache->fixtureDef(m, md);
            }
        }

        result = def ? QVariant(fixtureDefToMap(def)) : QVariant();
        return true;
    }

    error = QString("Unknown fixture library operation '%1'").arg(op);
    return false;
}

/*********************************************************************
 * Input/Output
 *********************************************************************/

static QVariant outputPatchToMap(const OutputPatch *patch)
{
    if (patch == nullptr || patch->pluginName() == KOutputNone || patch->pluginName().isEmpty())
        return QVariant();
    QVariantMap map;
    map["plugin"] = patch->pluginName();
    map["line"] = patch->output();
    map["name"] = patch->outputName();
    return map;
}

static QVariant inputPatchToMap(const InputPatch *patch)
{
    if (patch == nullptr || patch->pluginName() == KInputNone || patch->pluginName().isEmpty())
        return QVariant();
    QVariantMap map;
    map["plugin"] = patch->pluginName();
    map["line"] = patch->input();
    map["name"] = patch->inputName();
    return map;
}

bool NativeApi::ioQuery(QVariant &result, QString &error)
{
    Q_UNUSED(error)
    InputOutputMap *ioMap = m_app->doc()->inputOutputMap();
    QVariantMap map;

    QVariantList outputs;
    for (const QString &plugin : ioMap->outputPluginNames())
    {
        QVariantMap p;
        p["name"] = plugin;
        p["lines"] = ioMap->pluginOutputs(plugin);
        outputs.append(p);
    }
    map["outputPlugins"] = outputs;

    QVariantList inputs;
    for (const QString &plugin : ioMap->inputPluginNames())
    {
        QVariantMap p;
        p["name"] = plugin;
        p["lines"] = ioMap->pluginInputs(plugin);
        inputs.append(p);
    }
    map["inputPlugins"] = inputs;

    QVariantList universes;
    for (quint32 i = 0; i < ioMap->universesCount(); i++)
    {
        QVariantMap u;
        u["universe"] = i + 1;
        u["name"] = ioMap->getUniverseNameByIndex(int(i));
        u["output"] = outputPatchToMap(ioMap->outputPatch(i));
        u["input"] = inputPatchToMap(ioMap->inputPatch(i));
        u["feedback"] = outputPatchToMap(ioMap->feedbackPatch(i));
        universes.append(u);
    }
    map["universes"] = universes;

    result = map;
    return true;
}

bool NativeApi::ioPatch(const QVariantMap &args, QVariant &result, QString &error)
{
    InputOutputMap *ioMap = m_app->doc()->inputOutputMap();
    quint32 universe = args.value("universe").toUInt();
    QString direction = args.value("direction").toString();
    QString plugin = args.value("plugin").toString();
    bool unpatch = plugin.isEmpty() || plugin.compare("None", Qt::CaseInsensitive) == 0;
    quint32 line = unpatch ? QLCIOPlugin::invalidLine() : args.value("line").toUInt();
    QVariantMap params = args.value("params").toMap();

    if (universe >= ioMap->universesCount())
    {
        error = QString("Universe %1 does not exist").arg(universe + 1);
        return false;
    }

    bool ok = false;
    if (direction == "output")
    {
        ok = ioMap->setOutputPatch(universe, unpatch ? KOutputNone : plugin, "", "", line, false, 0);
        OutputPatch *patch = ioMap->outputPatch(universe);
        if (ok && patch)
            for (auto it = params.constBegin(); it != params.constEnd(); ++it)
                patch->setPluginParameter(it.key(), it.value());
    }
    else if (direction == "input")
    {
        ok = ioMap->setInputPatch(universe, unpatch ? KInputNone : plugin, "", "", line);
        InputPatch *patch = ioMap->inputPatch(universe);
        if (ok && patch)
            for (auto it = params.constBegin(); it != params.constEnd(); ++it)
                patch->setPluginParameter(it.key(), it.value());
    }
    else if (direction == "feedback")
    {
        ok = ioMap->setOutputPatch(universe, unpatch ? KOutputNone : plugin, "", "", line, true);
    }
    else
    {
        error = QString("Unknown patch direction '%1'").arg(direction);
        return false;
    }

    if (ok == false)
    {
        error = QString("QLC+ refused to patch universe %1 to %2 line %3")
                    .arg(universe + 1).arg(plugin).arg(line);
        return false;
    }

    m_app->doc()->setModified();

    QVariantMap map;
    map["universe"] = universe + 1;
    map["output"] = outputPatchToMap(ioMap->outputPatch(universe));
    map["input"] = inputPatchToMap(ioMap->inputPatch(universe));
    map["feedback"] = outputPatchToMap(ioMap->feedbackPatch(universe));
    result = map;
    return true;
}

/*********************************************************************
 * Editing operations with no Tardis action
 *********************************************************************/

bool NativeApi::fixtureGroupDelete(const QVariantMap &args, QVariant &result, QString &error)
{
    quint32 id = args.value("id").toUInt();
    Doc *doc = m_app->doc();
    if (doc->fixtureGroup(id) == nullptr)
    {
        error = QString("Fixture group %1 does not exist").arg(id);
        return false;
    }

    if (doc->deleteFixtureGroup(id) == false)
    {
        error = QString("QLC+ could not delete fixture group %1").arg(id);
        return false;
    }

    QVariantMap map;
    map["deleted"] = id;
    result = map;
    return true;
}

bool NativeApi::vcPageAdd(const QVariantMap &args, QVariant &result, QString &error)
{
    Q_UNUSED(error)
    VirtualConsole *vc = m_app->virtualConsole();
    int index = vc->pagesCount();
    vc->addPage(index);

    VCPage *page = vc->page(index);
    QString caption = args.value("caption").toString();
    if (page && caption.isEmpty() == false)
        page->setCaption(caption);
    m_app->doc()->setModified();

    QVariantMap map;
    map["index"] = index;
    map["id"] = page ? QVariant(page->id()) : QVariant();
    result = map;
    return true;
}

bool NativeApi::vcPageRemove(const QVariantMap &args, QVariant &result, QString &error)
{
    VirtualConsole *vc = m_app->virtualConsole();
    int index = args.value("index", -1).toInt();
    if (index < 0 || index >= vc->pagesCount())
    {
        error = QString("Page index %1 does not exist").arg(index);
        return false;
    }
    if (vc->pagesCount() == 1)
    {
        error = "The Virtual Console needs at least one page";
        return false;
    }

    vc->deletePage(index);
    m_app->doc()->setModified();

    QVariantMap map;
    map["removed"] = index;
    result = map;
    return true;
}
