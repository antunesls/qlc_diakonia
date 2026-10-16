/*
  Q Light Controller Plus
  nativeapi.h

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

#ifndef NATIVEAPI_H
#define NATIVEAPI_H

#include <QObject>
#include <QVariantMap>
#include <QByteArray>
#include <QHash>
#include <QStringList>

class App;
class NetworkManager;

/** @addtogroup qmlui QLC+ QML UI
 * @{
 */

/**
 * Extended native API: project management, fixture library queries,
 * I/O patching and the few editing operations that have no Tardis action.
 *
 * NetworkManager validates authentication and access rights, then emits
 * extendedRequest(). Each request is answered exactly once through
 * NetworkManager::sendCommandResult, with a JSON document on success or a
 * human readable message on failure.
 */
class NativeApi final : public QObject
{
    Q_OBJECT

public:
    NativeApi(App *app, NetworkManager *networkManager);

    /** Version of the extended protocol, reported by NetApiInfo */
    static constexpr int apiLevel = 1;

    /** Features advertised by NetApiInfo, matching the client feature names */
    static QStringList features();

protected slots:
    void slotExtendedRequest(QString sessionId, int actionCode, quint32 requestId,
                             QVariantMap arguments, int accessMask);

private:
    /** Each handler fills $result on success or $error on failure */
    bool apiInfo(int accessMask, QVariant &result, QString &error);
    bool projectSave(const QVariantMap &args, QVariant &result, QString &error);
    bool projectNew(QVariant &result, QString &error);
    bool projectLoadFile(const QVariantMap &args, QVariant &result, QString &error);
    bool projectUpload(const QString &sessionId, const QVariantMap &args,
                       QVariant &result, QString &error);
    bool fixtureLibraryQuery(const QVariantMap &args, QVariant &result, QString &error);
    bool ioQuery(QVariant &result, QString &error);
    bool ioPatch(const QVariantMap &args, QVariant &result, QString &error);
    bool fixtureGroupDelete(const QVariantMap &args, QVariant &result, QString &error);
    bool vcPageAdd(const QVariantMap &args, QVariant &result, QString &error);
    bool vcPageRemove(const QVariantMap &args, QVariant &result, QString &error);

private:
    App *m_app;
    NetworkManager *m_networkManager;

    /** Workspace chunks received by NetProjectUpload, per session */
    QHash<QString, QByteArray> m_uploads;
    QHash<QString, int> m_uploadNextIndex;
};

/** @} */

#endif /* NATIVEAPI_H */
