/*
  Q Light Controller Plus
  udpcommandserver.cpp

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

#include <QXmlStreamReader>
#include <QXmlStreamWriter>
#include <QNetworkInterface>
#include <QNetworkDatagram>
#include <QUdpSocket>
#include <QSettings>
#include <QDateTime>
#include <QDebug>

#include "udpcommandserver.h"
#include "app.h"

#include "doc.h"
#include "function.h"
#include "inputoutputmap.h"
#include "virtualconsole.h"
#include "vcwidget.h"
#include "vcbutton.h"
#include "vcslider.h"
#include "vccuelist.h"

#define SETTINGS_ENABLED        "udpcommands/enabled"
#define SETTINGS_PORT           "udpcommands/port"
#define SETTINGS_ALLOW_DIRECT   "udpcommands/allowdirect"

#define KXMLQLCUdpCommandsMap       QStringLiteral("Map")
#define KXMLQLCUdpCommandsCommand   QStringLiteral("Command")
#define KXMLQLCUdpCommandsAction    QStringLiteral("Action")
#define KXMLQLCUdpCommandsTarget    QStringLiteral("Target")

/* Keep replies inside a single safe UDP payload */
#define MAX_REPLY_BYTES 8000
#define MAX_LOG_ENTRIES 300

static const char *helpText =
    "OK commands: start|stop|toggle|status <function>; button|press|release <caption>; "
    "slider <caption> <0-255|N%>; cuelist <caption> play|stop|next|prev; "
    "blackout on|off|toggle; stopall; list functions|buttons|sliders|cuelists; ping";

UdpCommandServer::UdpCommandServer(App *app, QObject *parent)
    : QObject(parent)
    , m_app(app)
    , m_socket(nullptr)
{
    QSettings settings;
    m_enabled = settings.value(SETTINGS_ENABLED, false).toBool();
    m_port = settings.value(SETTINGS_PORT, defaultPort).toInt();
    m_allowDirect = settings.value(SETTINGS_ALLOW_DIRECT, true).toBool();

    if (m_enabled)
        restartSocket();
}

bool UdpCommandServer::startFromCommandLine(quint16 port)
{
    m_port = port;
    m_enabled = true;
    restartSocket();
    emit enabledChanged();
    emit portChanged();
    return listening();
}

/*********************************************************************
 * Settings
 *********************************************************************/

bool UdpCommandServer::enabled() const
{
    return m_enabled;
}

void UdpCommandServer::setEnabled(bool enable)
{
    if (m_enabled == enable)
        return;

    m_enabled = enable;
    QSettings().setValue(SETTINGS_ENABLED, enable);
    restartSocket();
    emit enabledChanged();
}

int UdpCommandServer::port() const
{
    return m_port;
}

void UdpCommandServer::setPort(int port)
{
    if (m_port == port || port < 1 || port > 65535)
        return;

    m_port = port;
    QSettings().setValue(SETTINGS_PORT, port);
    if (m_enabled)
        restartSocket();
    emit portChanged();
}

bool UdpCommandServer::listening() const
{
    return m_socket != nullptr;
}

QString UdpCommandServer::lastError() const
{
    return m_lastError;
}

bool UdpCommandServer::allowDirect() const
{
    return m_allowDirect;
}

void UdpCommandServer::setAllowDirect(bool allow)
{
    if (m_allowDirect == allow)
        return;

    m_allowDirect = allow;
    QSettings().setValue(SETTINGS_ALLOW_DIRECT, allow);
    emit allowDirectChanged();
}

QStringList UdpCommandServer::localAddresses() const
{
    QStringList addresses;
    for (const QHostAddress &address : QNetworkInterface::allAddresses())
    {
        if (address.protocol() == QAbstractSocket::IPv4Protocol && address.isLoopback() == false)
            addresses << address.toString();
    }
    return addresses;
}

void UdpCommandServer::restartSocket()
{
    if (m_socket != nullptr)
    {
        m_socket->close();
        m_socket->deleteLater();
        m_socket = nullptr;
    }
    m_lastError.clear();

    if (m_enabled)
    {
        QUdpSocket *socket = new QUdpSocket(this);
        if (socket->bind(QHostAddress::Any, quint16(m_port)))
        {
            connect(socket, &QUdpSocket::readyRead, this, &UdpCommandServer::slotReadyRead);
            m_socket = socket;
            qInfo() << "[UDP commands] listening on port" << m_port;
        }
        else
        {
            m_lastError = socket->errorString();
            qWarning() << "[UDP commands] cannot bind port" << m_port << m_lastError;
            delete socket;
        }
    }

    emit listeningChanged();
}

void UdpCommandServer::slotReadyRead()
{
    while (m_socket != nullptr && m_socket->hasPendingDatagrams())
    {
        QNetworkDatagram datagram = m_socket->receiveDatagram();
        if (datagram.isValid() == false)
            continue;

        QHostAddress sender = datagram.senderAddress();
        /* Show IPv4-mapped IPv6 senders as plain IPv4 */
        bool isIPv4 = false;
        quint32 ipv4 = sender.toIPv4Address(&isIPv4);
        const QString source = QString("%1:%2").arg(isIPv4 ? QHostAddress(ipv4).toString() : sender.toString())
                                               .arg(datagram.senderPort());

        const QStringList lines = QString::fromUtf8(datagram.data()).split('\n', Qt::SkipEmptyParts);
        for (const QString &line : lines)
        {
            if (line.trimmed().isEmpty())
                continue;

            QString reply = execute(line);
            appendLog(source, line.trimmed(), reply);

            QByteArray payload = reply.toUtf8();
            if (payload.size() > MAX_REPLY_BYTES)
                payload = payload.left(MAX_REPLY_BYTES - 4) + " ...";
            m_socket->writeDatagram(payload + '\n', datagram.senderAddress(), datagram.senderPort());
        }
    }
}

QString UdpCommandServer::execute(const QString &line)
{
    const QString text = line.trimmed();
    QString value;

    const Mapping *mapping = findMapping(text, value);
    if (mapping != nullptr)
        return runMapping(*mapping, value);

    if (m_allowDirect == false)
        return QString("ERR no mapping for '%1'").arg(text);

    return executeDirect(text);
}

/*********************************************************************
 * Mappings
 *********************************************************************/

QVariantList UdpCommandServer::mappings() const
{
    QVariantList list;
    for (const Mapping &m : m_mappings)
    {
        QVariantMap map;
        map.insert("command", m.command);
        map.insert("action", int(m.action));
        map.insert("target", m.target == Function::invalidId() ? -1 : qint64(m.target));
        map.insert("kind", targetKind(m.action));
        map.insert("targetLabel", describeTarget(m));
        list.append(map);
    }
    return list;
}

QVariantList UdpCommandServer::actionsModel() const
{
    static const QList<QPair<MappingAction, QString>> actions = {
        { StartFunction,   tr("Iniciar função") },
        { StopFunction,    tr("Parar função") },
        { ToggleFunction,  tr("Liga/desliga função") },
        { ClickButton,     tr("Clicar botão do VC") },
        { PressButton,     tr("Segurar botão do VC") },
        { ReleaseButton,   tr("Soltar botão do VC") },
        { SetSlider,       tr("Ajustar slider (valor após o comando)") },
        { CueListPlay,     tr("Cue list: play") },
        { CueListStop,     tr("Cue list: parar") },
        { CueListNext,     tr("Cue list: próximo passo") },
        { CueListPrevious, tr("Cue list: passo anterior") },
        { BlackoutOn,      tr("Blackout liga") },
        { BlackoutOff,     tr("Blackout desliga") },
        { BlackoutToggle,  tr("Blackout liga/desliga") },
        { StopAll,         tr("Parar tudo") },
    };

    QVariantList list;
    for (const auto &action : actions)
    {
        QVariantMap map;
        map.insert("mLabel", action.second);
        map.insert("mValue", int(action.first));
        list.append(map);
    }
    return list;
}

QVariantList UdpCommandServer::targetsModel(int kind) const
{
    QVariantList list;

    if (kind == FunctionTarget)
    {
        QList<Function *> functions = m_app->doc()->functions();
        std::sort(functions.begin(), functions.end(), [](Function *a, Function *b)
        {
            return QString::localeAwareCompare(a->name(), b->name()) < 0;
        });
        for (Function *f : functions)
        {
            QVariantMap map;
            map.insert("mLabel", QString("%1 (%2)").arg(f->name(), Function::typeToString(f->type())));
            map.insert("mValue", f->id());
            list.append(map);
        }
        return list;
    }

    int type;
    if (kind == ButtonTarget)
        type = VCWidget::ButtonWidget;
    else if (kind == SliderTarget)
        type = VCWidget::SliderWidget;
    else if (kind == CueListTarget)
        type = VCWidget::CueListWidget;
    else
        return list;

    const QVariantList widgets = m_app->virtualConsole()->widgetsList(QVariantList() << type);
    for (const QVariant &entry : widgets)
    {
        QVariantMap widget = entry.toMap();
        QVariantMap map;
        map.insert("mLabel", widget.value("label").toString());
        map.insert("mValue", widget.value("id").toUInt());
        list.append(map);
    }
    return list;
}

int UdpCommandServer::targetKind(int action)
{
    switch (action)
    {
        case StartFunction:
        case StopFunction:
        case ToggleFunction:
            return FunctionTarget;
        case ClickButton:
        case PressButton:
        case ReleaseButton:
            return ButtonTarget;
        case SetSlider:
            return SliderTarget;
        case CueListPlay:
        case CueListStop:
        case CueListNext:
        case CueListPrevious:
            return CueListTarget;
        default:
            return NoTarget;
    }
}

void UdpCommandServer::addMapping()
{
    m_mappings.append({ QString(), StartFunction, Function::invalidId() });
    mappingsModified();
}

void UdpCommandServer::removeMapping(int index)
{
    if (index < 0 || index >= m_mappings.count())
        return;

    m_mappings.removeAt(index);
    mappingsModified();
}

void UdpCommandServer::setMappingCommand(int index, QString command)
{
    if (index < 0 || index >= m_mappings.count() || m_mappings[index].command == command.trimmed())
        return;

    m_mappings[index].command = command.trimmed();
    mappingsModified();
}

void UdpCommandServer::setMappingAction(int index, int action)
{
    if (index < 0 || index >= m_mappings.count() || action < StartFunction || action > StopAll ||
        m_mappings[index].action == action)
        return;

    /* A target of another kind would point to an unrelated object */
    if (targetKind(action) != targetKind(m_mappings[index].action))
        m_mappings[index].target = Function::invalidId();

    m_mappings[index].action = MappingAction(action);
    mappingsModified();
}

void UdpCommandServer::setMappingTarget(int index, quint32 target)
{
    if (index < 0 || index >= m_mappings.count() || m_mappings[index].target == target)
        return;

    /* Accept only an existing object of the kind the action works on */
    const int kind = targetKind(m_mappings[index].action);
    bool valid = false;
    if (kind == FunctionTarget)
    {
        valid = m_app->doc()->function(target) != nullptr;
    }
    else if (kind != NoTarget)
    {
        for (const QVariant &entry : targetsModel(kind))
            valid = valid || entry.toMap().value("mValue").toUInt() == target;
    }
    if (valid == false)
        return;

    m_mappings[index].target = target;
    mappingsModified();
}

QString UdpCommandServer::testCommand(QString line)
{
    if (line.trimmed().isEmpty())
        return QString();

    QString reply = execute(line);
    appendLog(tr("teste"), line.trimmed(), reply);
    return reply;
}

void UdpCommandServer::mappingsModified()
{
    m_app->doc()->setModified();
    emit mappingsChanged();
}

const UdpCommandServer::Mapping *UdpCommandServer::findMapping(const QString &line, QString &value) const
{
    for (const Mapping &m : m_mappings)
    {
        if (m.command.isEmpty() == false && m.command.compare(line, Qt::CaseInsensitive) == 0)
            return &m;
    }

    /* "<command> <value>" for the actions that take a value */
    const int lastSpace = line.lastIndexOf(' ');
    if (lastSpace < 0)
        return nullptr;

    const QString command = line.left(lastSpace).trimmed();
    for (const Mapping &m : m_mappings)
    {
        if (m.action == SetSlider && m.command.compare(command, Qt::CaseInsensitive) == 0)
        {
            value = line.mid(lastSpace + 1);
            return &m;
        }
    }

    return nullptr;
}

QString UdpCommandServer::runMapping(const Mapping &mapping, const QString &value)
{
    if (targetKind(mapping.action) != NoTarget && mapping.target == Function::invalidId())
        return QString("ERR mapping '%1' has no target").arg(mapping.command);

    const QString target = QString::number(mapping.target);

    switch (mapping.action)
    {
        case StartFunction:   return executeDirect("start " + target);
        case StopFunction:    return executeDirect("stop " + target);
        case ToggleFunction:  return executeDirect("toggle " + target);
        case ClickButton:     return executeDirect("button " + target);
        case PressButton:     return executeDirect("press " + target);
        case ReleaseButton:   return executeDirect("release " + target);
        case SetSlider:
            if (value.isEmpty())
                return QString("ERR '%1' needs a value: %1 <0-255|N%>").arg(mapping.command);
            return executeDirect(QString("slider %1 %2").arg(target, value));
        case CueListPlay:     return executeDirect(QString("cuelist %1 play").arg(target));
        case CueListStop:     return executeDirect(QString("cuelist %1 stop").arg(target));
        case CueListNext:     return executeDirect(QString("cuelist %1 next").arg(target));
        case CueListPrevious: return executeDirect(QString("cuelist %1 prev").arg(target));
        case BlackoutOn:      return executeDirect("blackout on");
        case BlackoutOff:     return executeDirect("blackout off");
        case BlackoutToggle:  return executeDirect("blackout toggle");
        case StopAll:         return executeDirect("stopall");
    }

    return "ERR unknown mapping action";
}

QString UdpCommandServer::describeTarget(const Mapping &mapping) const
{
    if (mapping.target == Function::invalidId())
        return QString();

    if (targetKind(mapping.action) == FunctionTarget)
    {
        Function *f = m_app->doc()->function(mapping.target);
        return f ? f->name() : tr("(função removida)");
    }

    for (const QVariant &entry : m_app->virtualConsole()->widgetsList())
    {
        QVariantMap widget = entry.toMap();
        if (widget.value("id").toUInt() == mapping.target)
            return widget.value("label").toString();
    }
    return tr("(widget removido)");
}

void UdpCommandServer::resetMappings()
{
    m_mappings.clear();
    emit mappingsChanged();
}

bool UdpCommandServer::loadXML(QXmlStreamReader &root)
{
    if (root.name() != KXMLQLCUdpCommands)
    {
        qWarning() << Q_FUNC_INFO << "UDP commands node not found";
        return false;
    }

    m_mappings.clear();

    while (root.readNextStartElement())
    {
        if (root.name() == KXMLQLCUdpCommandsMap)
        {
            QXmlStreamAttributes attrs = root.attributes();
            int action = attrs.value(KXMLQLCUdpCommandsAction).toInt();
            if (action >= StartFunction && action <= StopAll)
            {
                Mapping m;
                m.command = attrs.value(KXMLQLCUdpCommandsCommand).toString();
                m.action = MappingAction(action);
                m.target = attrs.hasAttribute(KXMLQLCUdpCommandsTarget)
                         ? attrs.value(KXMLQLCUdpCommandsTarget).toUInt() : Function::invalidId();
                m_mappings.append(m);
            }
        }
        root.skipCurrentElement();
    }

    emit mappingsChanged();
    return true;
}

bool UdpCommandServer::saveXML(QXmlStreamWriter *doc) const
{
    if (m_mappings.isEmpty())
        return true;

    doc->writeStartElement(KXMLQLCUdpCommands);
    for (const Mapping &m : m_mappings)
    {
        doc->writeStartElement(KXMLQLCUdpCommandsMap);
        doc->writeAttribute(KXMLQLCUdpCommandsCommand, m.command);
        doc->writeAttribute(KXMLQLCUdpCommandsAction, QString::number(int(m.action)));
        if (m.target != Function::invalidId())
            doc->writeAttribute(KXMLQLCUdpCommandsTarget, QString::number(m.target));
        doc->writeEndElement();
    }
    doc->writeEndElement();

    return true;
}

/*********************************************************************
 * Log
 *********************************************************************/

QVariantList UdpCommandServer::log() const
{
    return m_log;
}

void UdpCommandServer::clearLog()
{
    m_log.clear();
    emit logChanged();
}

void UdpCommandServer::appendLog(const QString &source, const QString &command, const QString &reply)
{
    qDebug() << "[UDP commands]" << source << command << "->" << reply;

    QVariantMap entry;
    entry.insert("time", QDateTime::currentDateTime().toString("HH:mm:ss"));
    entry.insert("source", source);
    entry.insert("command", command);
    entry.insert("reply", reply);
    entry.insert("ok", reply.startsWith("OK"));

    /* Newest first */
    m_log.prepend(entry);
    while (m_log.count() > MAX_LOG_ENTRIES)
        m_log.removeLast();

    emit logChanged();
}

/*********************************************************************
 * Direct commands
 *********************************************************************/

Function *UdpCommandServer::findFunction(const QString &ref, QString &error) const
{
    Doc *doc = m_app->doc();
    if (ref.isEmpty())
    {
        error = "ERR missing function name";
        return nullptr;
    }

    bool isNumber = false;
    quint32 id = ref.toUInt(&isNumber);
    if (isNumber && doc->function(id) != nullptr)
        return doc->function(id);

    Function *found = nullptr;
    for (Function *f : doc->functions())
    {
        if (f->name().compare(ref, Qt::CaseInsensitive) != 0)
            continue;
        if (found != nullptr)
        {
            error = QString("ERR more than one function is named '%1', use its ID").arg(ref);
            return nullptr;
        }
        found = f;
    }

    if (found == nullptr)
        error = QString("ERR no function named '%1'").arg(ref);
    return found;
}

VCWidget *UdpCommandServer::findWidget(const QString &ref, int type, QString &error) const
{
    if (ref.isEmpty())
    {
        error = "ERR missing widget caption";
        return nullptr;
    }

    bool isNumber = false;
    quint32 id = ref.toUInt(&isNumber);

    const QVariantList widgets = m_app->virtualConsole()->widgetsList(QVariantList() << type);
    VCWidget *byId = nullptr;
    VCWidget *found = nullptr;

    for (const QVariant &entry : widgets)
    {
        VCWidget *widget = entry.toMap().value("classRef").value<VCWidget *>();
        if (widget == nullptr)
            continue;
        if (isNumber && widget->id() == id)
            byId = widget;
        if (widget->caption().compare(ref, Qt::CaseInsensitive) != 0)
            continue;
        if (found != nullptr)
        {
            error = QString("ERR more than one widget is captioned '%1', use its ID").arg(ref);
            return nullptr;
        }
        found = widget;
    }

    if (found == nullptr)
        found = byId;
    if (found == nullptr)
        error = QString("ERR no widget captioned '%1'").arg(ref);
    return found;
}

QString UdpCommandServer::listItems(const QString &what) const
{
    QStringList names;

    if (what == "functions")
    {
        for (Function *f : m_app->doc()->functions())
            names << QString("%1:%2 (%3)").arg(f->id()).arg(f->name(), Function::typeToString(f->type()));
    }
    else
    {
        int type;
        if (what == "buttons")
            type = VCWidget::ButtonWidget;
        else if (what == "sliders")
            type = VCWidget::SliderWidget;
        else if (what == "cuelists")
            type = VCWidget::CueListWidget;
        else
            return "ERR list functions|buttons|sliders|cuelists";

        const QVariantList widgets = m_app->virtualConsole()->widgetsList(QVariantList() << type);
        for (const QVariant &entry : widgets)
        {
            QVariantMap map = entry.toMap();
            names << QString("%1:%2").arg(map.value("id").toUInt()).arg(map.value("label").toString());
        }
    }

    return "OK " + names.join(" | ");
}

QString UdpCommandServer::executeDirect(const QString &text)
{
    const int space = text.indexOf(' ');
    const QString verb = (space < 0 ? text : text.left(space)).toLower();
    const QString arg = space < 0 ? QString() : text.mid(space + 1).trimmed();
    QString error;

    if (verb == "ping")
        return "OK pong";

    if (verb == "help")
        return helpText;

    if (verb == "list")
        return listItems(arg.toLower());

    if (verb == "stopall")
    {
        m_app->stopAllFunctions();
        return "OK stopall";
    }

    if (verb == "blackout")
    {
        InputOutputMap *ioMap = m_app->doc()->inputOutputMap();
        const QString mode = arg.toLower();
        if (mode == "on")
            ioMap->setBlackout(true);
        else if (mode == "off")
            ioMap->setBlackout(false);
        else if (mode == "toggle" || mode.isEmpty())
            ioMap->toggleBlackout();
        else
            return "ERR blackout on|off|toggle";
        return QString("OK blackout %1").arg(ioMap->blackout() ? "on" : "off");
    }

    if (verb == "start" || verb == "stop" || verb == "toggle" || verb == "status")
    {
        Function *f = findFunction(arg, error);
        if (f == nullptr)
            return error;

        if (verb == "status")
            return QString("OK %1 %2").arg(f->name(), f->isRunning() ? "running" : "stopped");

        bool run = verb == "start" || (verb == "toggle" && f->isRunning() == false);
        if (run && f->isRunning() == false)
            f->start(m_app->doc()->masterTimer(), FunctionParent::master());
        else if (run == false && f->isRunning())
            f->stop(FunctionParent::master());

        return QString("OK %1 %2").arg(f->name(), run ? "started" : "stopped");
    }

    if (verb == "button" || verb == "press" || verb == "release")
    {
        VCButton *button = qobject_cast<VCButton *>(findWidget(arg, VCWidget::ButtonWidget, error));
        if (button == nullptr)
            return error;

        if (verb == "button")
        {
            button->requestStateChange(true);
            /* Flash buttons only stay on while held: a plain click releases them */
            if (button->actionType() == VCButton::Flash)
                button->requestStateChange(false);
        }
        else
        {
            button->requestStateChange(verb == "press");
        }
        return QString("OK %1 %2").arg(verb, button->caption());
    }

    if (verb == "slider" || verb == "cuelist")
    {
        const int lastSpace = arg.lastIndexOf(' ');
        if (lastSpace < 0)
            return QString("ERR %1 <caption> <%2>").arg(verb, verb == "slider" ? "0-255|N%" : "play|stop|next|prev");
        const QString ref = arg.left(lastSpace).trimmed();
        const QString param = arg.mid(lastSpace + 1).toLower();

        if (verb == "slider")
        {
            VCSlider *slider = qobject_cast<VCSlider *>(findWidget(ref, VCWidget::SliderWidget, error));
            if (slider == nullptr)
                return error;

            bool ok = false;
            int value;
            if (param.endsWith('%'))
                value = qRound(param.chopped(1).toDouble(&ok) * 255.0 / 100.0);
            else
                value = param.toInt(&ok);
            if (ok == false || value < 0 || value > 255)
                return "ERR slider value must be 0-255 or 0%-100%";

            slider->setValue(value);
            return QString("OK slider %1 %2").arg(slider->caption()).arg(value);
        }

        VCCueList *cueList = qobject_cast<VCCueList *>(findWidget(ref, VCWidget::CueListWidget, error));
        if (cueList == nullptr)
            return error;

        if (param == "play")
            cueList->playClicked();
        else if (param == "stop")
            cueList->stopClicked();
        else if (param == "next")
            cueList->nextClicked();
        else if (param == "prev" || param == "previous")
            cueList->previousClicked();
        else
            return "ERR cuelist <caption> play|stop|next|prev";
        return QString("OK cuelist %1 %2").arg(cueList->caption(), param);
    }

    return QString("ERR unknown command '%1' (send 'help')").arg(verb);
}
